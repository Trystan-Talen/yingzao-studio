import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import { createCreditService, type CreditService } from '../src/server/tasks/credits';
import { createBillingAdmin } from '../src/server/billing/admin';
import type { Actor } from '../src/contracts/core';
import type { EntitlementLimits } from '../src/contracts/entitlements';
let folder: string,
  db: DatabaseContext,
  core: CoreServices,
  credits: CreditService,
  actor: Actor,
  wid: string,
  admin: ReturnType<typeof createBillingAdmin>;
const reason = 'Administrator reviewed entitlement rules and support evidence before approval.';
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-entitlements-'));
  db = createDatabaseContext(join(folder, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  credits = createCreditService(db);
  core = createCoreServices(
    db,
    {
      storageDir: join(folder, 'media'),
      sessionSecret: 'test-secret',
      publicOrigin: 'http://127.0.0.1:5174',
      isProduction: false,
      demoMode: false,
    },
    {
      onWorkspaceCreated: (w, u) => credits.initialize(w, u, 100),
      onMemberBudgetChanged: (w, u, l) => credits.budget(w, u, l),
    },
  );
  const reg = await core.auth.register({
    email: 'owner@example.local',
    password: 'OwnerPassword2026!',
    displayName: 'Owner',
  });
  actor = {
    userId: reg.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = reg.workspace.id;
  admin = createBillingAdmin(db);
});
afterEach(async () => {
  closeDatabase(db);
  await rm(folder, { recursive: true, force: true });
});
function defaults(partial: Partial<EntitlementLimits>) {
  const limits = { ...core.entitlements.effective(wid).limits, ...partial };
  return admin.configureEntitlements({
    actorUserId: actor.userId,
    reason,
    mode: 'standard',
    limits,
  });
}
function itemFixture(creditsAmount = 10, operation = 'image.generate', who = actor, space = wid) {
  const jid = randomUUID(),
    iid = randomUUID(),
    date = new Date().toISOString();
  db.sqlite
    .prepare(
      "INSERT INTO jobs(id,workspace_id,user_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,created_at,updated_at) VALUES(?,?,?,?,'fixture','synthetic accounting fixture','{}','fixture',?,'fixture','queued','queued',?,?,?)",
    )
    .run(jid, space, who.userId, operation, randomUUID(), creditsAmount, date, date);
  db.sqlite
    .prepare(
      "INSERT INTO job_items(id,job_id,workspace_id,user_id,item_index,input_json,status,credits,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,0,'{}','queued',?,?,?,?)",
    )
    .run(iid, jid, space, who.userId, creditsAmount, date, date, date);
  return { jid, iid, who, space, creditsAmount };
}
function settled() {
  const f = itemFixture();
  credits.reserve(f.space, f.who.userId, f.creditsAmount, f.jid, f.iid);
  credits.finish(f.space, f.who.userId, f.creditsAmount, f.jid, f.iid, true);
  db.sqlite
    .prepare("UPDATE jobs SET status='succeeded',stage='complete',settled_credits=10 WHERE id=?")
    .run(f.jid);
  db.sqlite
    .prepare("UPDATE job_items SET status='succeeded',phase='complete' WHERE id=?")
    .run(f.iid);
  return f;
}
function appeal(f: ReturnType<typeof itemFixture>) {
  return core.business.createTicket(actor, wid, {
    subject: 'Review requested',
    category: 'appeal',
    message: 'Please review this specific settled output.',
    jobId: f.jid,
  });
}
function decision(ticketId: string, items: { itemId: string; credits: number }[]) {
  return {
    actorUserId: actor.userId,
    workspaceId: wid,
    ticketId,
    decision: 'approved',
    reason,
    evidenceReference: 'review-case:123',
    items,
  };
}
describe('persistent entitlement enforcement', () => {
  it('enforces counts on create and restore without deleting existing resources after a downgrade', () => {
    defaults({ projects: 1, brands: 1, characters: 1, apiKeys: 1 });
    const project = core.projects.create(actor, wid, { name: 'One' });
    expect(() => core.projects.create(actor, wid, { name: 'Two' })).toThrow();
    core.projects.remove(actor, wid, project.id);
    const second = core.projects.create(actor, wid, { name: 'Two' });
    expect(() => core.projects.restore(actor, wid, project.id)).toThrow();
    expect(core.projects.get(actor, wid, second.id).id).toBe(second.id);
    const brand = core.references.createBrand(actor, wid, { name: 'Brand' });
    expect(() => core.references.createBrand(actor, wid, { name: 'Extra' })).toThrow();
    core.references.createCharacter(actor, wid, { name: 'Person' });
    expect(() => core.references.createCharacter(actor, wid, { name: 'Extra' })).toThrow();
    const key = core.business.createKey(actor, wid, { name: 'Key', scopes: ['jobs:read'] });
    expect(() =>
      core.business.createKey(actor, wid, { name: 'Extra', scopes: ['jobs:read'] }),
    ).toThrow();
    core.business.revokeKey(actor, wid, key.key.id);
    expect(
      core.business.createKey(actor, wid, { name: 'Replacement', scopes: ['jobs:read'] }).secret,
    ).toMatch(/^yz_/);
    defaults({ brands: 2 });
    core.references.createBrand(actor, wid, { name: 'Second' });
    defaults({ brands: 1 });
    expect(core.references.getBrand(actor, wid, brand.id).name).toBe('Brand');
    expect(core.entitlements.get(actor, wid).used.brands).toBe(2);
    expect(() => core.references.createBrand(actor, wid, { name: 'Third' })).toThrow();
  });
  it('counts live invitations as reserved seats and rechecks quota at invited registration', async () => {
    defaults({ seats: 2 });
    const team = core.auth.createWorkspace(actor.userId, 'Team', 'team');
    const invite = core.team.invite(actor, team.id, { email: 'new@example.local', role: 'member' });
    expect(() =>
      core.team.invite(actor, team.id, { email: 'extra@example.local', role: 'member' }),
    ).toThrow();
    defaults({ seats: 1 });
    const input = {
      email: 'new@example.local',
      password: 'NewPassword2026!',
      displayName: 'New',
      inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
    };
    await expect(core.auth.register(input)).rejects.toMatchObject({ code: 'ENTITLEMENT_LIMIT' });
    expect(
      db.sqlite.prepare('SELECT id FROM users WHERE email=?').get(input.email),
    ).toBeUndefined();
    defaults({ seats: 2 });
    await core.auth.register(input);
    expect(core.entitlements.get(actor, team.id).used.seats).toBe(2);
  });
  it('uses paid active subscription snapshots and stops new grants after expiration', () => {
    defaults({ projects: 1, concurrency: 1 });
    core.context.config.exportWatermark = { mode: 'non-subscribers', text: 'Studio', opacity: 0.3 };
    expect(core.entitlements.exportPolicy(wid)).toMatchObject({
      reason: 'required',
      watermark: { text: 'Studio' },
    });
    const pid = randomUUID();
    admin.importPlans({
      version: 1,
      actorUserId: actor.userId,
      reason,
      confirmCommercialCatalog: true,
      plans: [
        {
          id: pid,
          name: 'Subscription fixture',
          kind: 'subscription',
          priceMinor: 1000,
          currency: 'USD',
          credits: 100,
          interval: 'month',
          limits: { projects: 3, concurrency: 4, textAssistDailyFreeUnits: 2 },
        },
      ],
    });
    const order = core.business.createOrder(actor, wid, { planId: pid });
    db.sqlite.prepare("UPDATE orders SET status='paid' WHERE id=?").run(order.id);
    const sid = randomUUID(),
      date = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO subscriptions(id,workspace_id,plan_id,status,current_period_start,current_period_end,created_at,updated_at,source_order_id) VALUES(?,?,?,'active',?,?,?,?,?)",
      )
      .run(
        sid,
        wid,
        pid,
        new Date(Date.now() - 1000).toISOString(),
        new Date(Date.now() + 60000).toISOString(),
        date,
        date,
        order.id,
      );
    expect(core.entitlements.effective(wid)).toMatchObject({
      source: 'subscription',
      limits: { projects: 3, concurrency: 4, textAssistDailyFreeUnits: 2 },
    });
    expect(core.entitlements.exportPolicy(wid)).toMatchObject({
      reason: 'subscription-exempt',
      watermark: null,
    });
    db.sqlite.prepare('UPDATE plans SET limits_json=? WHERE id=?').run('{"projects":999}', pid);
    expect(core.entitlements.effective(wid).limits.projects).toBe(3);
    const project = core.projects.create(actor, wid, { name: 'One' });
    core.projects.create(actor, wid, { name: 'Two' });
    db.sqlite
      .prepare("UPDATE subscriptions SET current_period_end='2000-01-01T00:00:00.000Z' WHERE id=?")
      .run(sid);
    expect(core.entitlements.effective(wid).limits.concurrency).toBe(1);
    expect(core.entitlements.exportPolicy(wid)).toMatchObject({
      reason: 'required',
      watermark: { text: 'Studio' },
    });
    expect(() => core.projects.create(actor, wid, { name: 'Third' })).toThrow();
    expect(core.projects.get(actor, wid, project.id).name).toBe('One');
  });
  it('claims free text attempts atomically per workspace and day, never as transferable credits', () => {
    expect(core.entitlements.get(actor, wid).freeTextAssist.remaining).toBe(0);
    defaults({ textAssistDailyFreeUnits: 1 });
    const one = itemFixture(0, 'text.assist');
    const claim = () => core.entitlements.claimFreeTextAssist(actor, wid, one.jid, [one.iid]);
    expect(claim).toThrow('transaction');
    db.sqlite.transaction(claim).immediate();
    db.sqlite.transaction(claim).immediate();
    expect(core.entitlements.get(actor, wid).freeTextAssist).toMatchObject({
      used: 1,
      remaining: 0,
    });
    expect(credits.account(wid).balance).toBe(100);
    const two = itemFixture(0, 'text.assist');
    expect(() =>
      db.sqlite
        .transaction(() => core.entitlements.claimFreeTextAssist(actor, wid, two.jid, [two.iid]))
        .immediate(),
    ).toThrow();
    expect(() =>
      db.sqlite
        .transaction(() => core.entitlements.claimFreeTextAssist(actor, wid, two.jid, [one.iid]))
        .immediate(),
    ).toThrow();
    db.sqlite.prepare("UPDATE free_text_claims SET period_day='2000-01-01'").run();
    db.sqlite
      .transaction(() => core.entitlements.claimFreeTextAssist(actor, wid, two.jid, [two.iid]))
      .immediate();
    expect(core.entitlements.get(actor, wid).freeTextAssist.used).toBe(1);
  });
});
describe('audited appeal accounting', () => {
  it('refunds only the settled amount once, persists resolution, and notifies the submitter', () => {
    const f = settled(),
      ticket = appeal(f),
      input = decision(ticket.id, [{ itemId: f.iid, credits: 10 }]);
    expect(credits.account(wid).balance).toBe(90);
    const result = admin.resolveAppeal(input);
    expect(result).toMatchObject({ refundedCredits: 10, alreadyProcessed: false });
    expect(admin.resolveAppeal(input)).toMatchObject({ alreadyProcessed: true });
    expect(credits.account(wid).balance).toBe(100);
    expect(
      db.sqlite
        .prepare('SELECT spent FROM member_budgets WHERE workspace_id=? AND user_id=?')
        .get(wid, actor.userId),
    ).toEqual({ spent: 0 });
    expect(core.business.ticket(actor, wid, ticket.id)).toMatchObject({
      status: 'resolved',
      resolution: {
        decision: 'approved',
        refundedCredits: 10,
        items: [{ itemId: f.iid, credits: 10 }],
      },
    });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) n FROM credit_ledger WHERE event_key LIKE 'appeal-refund:%'")
        .get(),
    ).toEqual({ n: 1 });
    expect(
      db.sqlite
        .prepare('SELECT COUNT(*) n FROM notifications WHERE event_key=?')
        .get(`appeal:${ticket.id}`),
    ).toEqual({ n: 1 });
    expect(() => admin.resolveAppeal({ ...input, reason: reason + ' Changed' })).toThrow();
    const duplicate = appeal(f);
    expect(() =>
      admin.resolveAppeal(decision(duplicate.id, [{ itemId: f.iid, credits: 1 }])),
    ).toThrow();
    expect(core.business.ticket(actor, wid, duplicate.id).resolution).toBeNull();
  });
  it('rejects over-refunds, uncharged items, other jobs, closed tickets and non-operators', () => {
    const f = settled(),
      ticket = appeal(f),
      other = itemFixture();
    expect(() =>
      admin.resolveAppeal(decision(ticket.id, [{ itemId: f.iid, credits: 11 }])),
    ).toThrow();
    expect(() =>
      admin.resolveAppeal(decision(ticket.id, [{ itemId: other.iid, credits: 1 }])),
    ).toThrow();
    const pendingTicket = appeal(other);
    expect(() =>
      admin.resolveAppeal(decision(pendingTicket.id, [{ itemId: other.iid, credits: 1 }])),
    ).toThrow();
    expect(() =>
      admin.resolveAppeal({
        ...decision(ticket.id, [{ itemId: f.iid, credits: 10 }]),
        actorUserId: randomUUID(),
      }),
    ).toThrow();
    core.business.withdraw(actor, wid, ticket.id);
    expect(() =>
      admin.resolveAppeal(decision(ticket.id, [{ itemId: f.iid, credits: 10 }])),
    ).toThrow();
    expect(credits.account(wid).balance).toBe(90);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM support_refunds').get()).toEqual({ n: 0 });
  });
  it('records a rejected appeal without changing any credits', () => {
    const f = settled(),
      ticket = appeal(f);
    expect(admin.resolveAppeal({ ...decision(ticket.id, []), decision: 'rejected' })).toMatchObject(
      { refundedCredits: 0, decision: 'rejected' },
    );
    expect(credits.account(wid).balance).toBe(90);
    expect(() => core.business.withdraw(actor, wid, ticket.id)).toThrow();
  });
});
