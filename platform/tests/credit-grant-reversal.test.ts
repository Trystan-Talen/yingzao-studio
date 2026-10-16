import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Actor } from '../src/contracts/core';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import { createCreditService } from '../src/server/tasks/credits';
let db: ReturnType<typeof createDatabaseContext>,
  credits: ReturnType<typeof createCreditService>,
  actor: Actor,
  wid: string;
beforeEach(async () => {
  db = createDatabaseContext(':memory:');
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  credits = createCreditService(db);
  const core = createCoreServices(
    db,
    {
      storageDir: '/tmp/unused-reversal-fixture',
      sessionSecret: 'fixture',
      publicOrigin: 'http://127.0.0.1:5174',
      demoMode: false,
    } as never,
    { onWorkspaceCreated: (w, u) => credits.initialize(w, u, 100) },
  );
  const user = await core.auth.register({
    email: 'reversal@example.local',
    password: 'ReversalFixture2026!',
    displayName: 'Fixture',
  });
  wid = user.workspace.id;
  actor = {
    userId: user.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
});
afterEach(() => closeDatabase(db));
function reward(amount = 15, expiresAt: string | null = null) {
  return credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: randomUUID(),
    amount,
    source: 'referral',
    description: 'Reward fixture',
    expiresAt,
  }).lotId!;
}
function reverse(lotId: string, targetReversed: number, eventKey = randomUUID()) {
  return credits.revokeGrant({
    workspaceId: wid,
    userId: actor.userId,
    lotId,
    targetReversed,
    eventKey,
    description: 'Revoke only original referral source',
  });
}
it('only revokes the original grant and reports spent or reserved debt, without touching purchases', () => {
  const lotId = reward(),
    job = randomUUID(),
    spent = randomUUID(),
    pending = randomUUID();
  // Referral source must be spent before permanent purchased source.
  db.sqlite
    .prepare('UPDATE credit_lots SET expires_at=? WHERE id=?')
    .run('2099-01-01T00:00:00.000Z', lotId);
  credits.reserve(wid, actor.userId, 5, job, spent);
  credits.finish(wid, actor.userId, 5, job, spent, true);
  credits.reserve(wid, actor.userId, 3, job, pending);
  expect(reverse(lotId, 15)).toEqual({ deducted: 7, expired: 0, debt: 8 });
  expect(credits.account(wid)).toEqual({ balance: 103, reserved: 3 });
  expect(credits.buckets(wid).find((b) => b.source === 'initial')?.remaining).toBe(100);
  expect(credits.buckets(wid).find((b) => b.id === lotId)).toMatchObject({
    remaining: 3,
    reserved: 3,
  });
});
it('does not charge unrelated credits when the reward already expired', () => {
  const lotId = reward(10, '2000-01-01T00:00:00.000Z');
  expect(reverse(lotId, 10)).toEqual({ deducted: 0, expired: 10, debt: 0 });
  expect(credits.account(wid).balance).toBe(100);
});
it('applies cumulative partial reversals and idempotent event replay within the account', () => {
  const lotId = reward(),
    event = randomUUID();
  expect(reverse(lotId, 5, event)).toEqual({ deducted: 5, expired: 0, debt: 0 });
  expect(reverse(lotId, 5, event)).toEqual({ deducted: 5, expired: 0, debt: 0 });
  expect(reverse(lotId, 8)).toEqual({ deducted: 3, expired: 0, debt: 0 });
  expect(reverse(lotId, 8)).toEqual({ deducted: 0, expired: 0, debt: 0 });
  expect(() => reverse(lotId, 7)).toThrow();
  expect(() =>
    credits.forChannel('api').revokeGrant({
      workspaceId: wid,
      userId: actor.userId,
      lotId,
      targetReversed: 8,
      eventKey: randomUUID(),
      description: 'wrong channel',
    }),
  ).toThrow();
  expect(credits.account(wid).balance).toBe(107);
});
