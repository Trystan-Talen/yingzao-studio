import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Actor } from '../src/contracts/core';
import { notificationQuerySchema } from '../src/contracts/notifications';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import type { DatabaseContext } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { CoreContext } from '../src/server/core/shared';
import { BusinessService } from '../src/server/core/business';
import { NotificationService } from '../src/server/core/notifications';

let db: DatabaseContext,
  context: CoreContext,
  notifications: NotificationService,
  business: BusinessService,
  owner: Actor,
  member: Actor,
  stranger: Actor,
  wid: string,
  otherWid: string;
const createdAt = '2026-10-16T00:00:00.000Z';

function user(label: string): Actor {
  const id = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(
      id,
      `${label}@notifications.example.test`,
      'test-fixture-no-login',
      label,
      createdAt,
      createdAt,
    );
  return { userId: id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] };
}
function membership(actor: Actor, workspaceId: string, role = 'member') {
  db.sqlite
    .prepare(
      'INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(randomUUID(), workspaceId, actor.userId, role, createdAt, createdAt);
}
function workspace(label: string) {
  const id = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO workspaces(id,name,kind,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(id, label, 'team', owner.userId, createdAt, createdAt);
  membership(owner, id, 'owner');
  return id;
}
function message(
  input: {
    eventKey?: string | null;
    userId?: string;
    workspaceId?: string;
    readAt?: string | null;
    title?: string;
    text?: string;
    id?: string;
    at?: string;
  } = {},
) {
  const id = input.id ?? randomUUID();
  db.sqlite
    .prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?)')
    .run(
      id,
      input.workspaceId ?? wid,
      input.userId ?? owner.userId,
      input.title ?? '真实已有事件通知',
      input.text ?? '通知内容仅是数据，不用于猜测分类。',
      input.eventKey ?? null,
      input.readAt ?? null,
      input.at ?? createdAt,
    );
  return id;
}
function reviewEvent(input: { userId?: string; workspaceId?: string } = {}) {
  const ticketId = randomUUID(),
    userId = input.userId ?? owner.userId,
    workspaceId = input.workspaceId ?? wid;
  db.sqlite
    .prepare(
      'INSERT INTO support_tickets(id,workspace_id,created_by,subject,category,message,job_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      ticketId,
      workspaceId,
      userId,
      '实际申诉记录',
      'appeal',
      '测试审核事实',
      randomUUID(),
      'resolved',
      createdAt,
      createdAt,
    );
  db.sqlite
    .prepare('INSERT INTO support_resolutions VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(
      randomUUID(),
      ticketId,
      workspaceId,
      'approved',
      '测试审核决定',
      '本机合同证据',
      owner.userId,
      'fixture-decision-hash',
      0,
      createdAt,
    );
  return `appeal:${ticketId}`;
}

beforeEach(() => {
  db = createDatabaseContext(':memory:');
  // Exercise current permission dependencies without touching any existing database.
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  context = new CoreContext(
    db,
    {
      storageDir: '/tmp/notification-contract-fixture-unused',
      sessionSecret: 'notification-contract-fixture',
      publicOrigin: 'http://127.0.0.1:5173',
      isProduction: false,
      demoMode: false,
    },
    {},
  );
  notifications = new NotificationService(context);
  business = new BusinessService(context);
  owner = user('owner');
  member = user('member');
  stranger = user('stranger');
  wid = workspace('通知空间');
  otherWid = workspace('其他空间');
  membership(member, wid, 'viewer');
});
afterEach(() => {
  vi.restoreAllMocks();
  closeDatabase(db);
});

it('validates category and bounded pagination while preserving the default all-category query', () => {
  expect(notificationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 24 });
  expect(notificationQuerySchema.parse({ page: '2', pageSize: '25', category: 'review' })).toEqual({
    page: 2,
    pageSize: 25,
    category: 'review',
  });
  for (const invalid of [{ page: 0 }, { page: 1.5 }, { pageSize: 101 }, { category: 'unknown' }])
    expect(notificationQuerySchema.safeParse(invalid).success).toBe(false);
});

it('paginates 25 system notices plus one review with stable order and full unread counts', () => {
  const ids = Array.from({ length: 25 }, (_, index) =>
    message({ id: `system-${String(index).padStart(2, '0')}`, eventKey: `system:${index}` }),
  );
  const reviewId = message({ id: 'review-00', eventKey: reviewEvent() });
  const first = notifications.list(owner, wid, { page: 1, pageSize: 25 });
  const second = notifications.list(owner, wid, { page: 2, pageSize: 25 });
  expect(first).toMatchObject({
    total: 26,
    page: 1,
    pageSize: 25,
    unread: { system: 25, review: 1, total: 26 },
  });
  expect(first.items.map((item) => item.id)).toEqual([reviewId, ...ids.slice(0, 24)]);
  expect(second.items.map((item) => item.id)).toEqual([ids[24]]);
  expect(second.unread).toEqual(first.unread);
  expect(notifications.list(owner, wid, { page: 1, pageSize: 25 })).toEqual(first);
  expect(
    notifications.list(owner, wid, { category: 'system', page: 2, pageSize: 24 }),
  ).toMatchObject({
    items: [{ id: ids[24], category: 'system' }],
    total: 25,
    unread: first.unread,
  });
  expect(notifications.list(owner, wid, { category: 'review' })).toMatchObject({
    items: [{ id: reviewId, category: 'review' }],
    total: 1,
    unread: first.unread,
  });
});

it('orders newer notices first and uses an ID tie-breaker within a timestamp', () => {
  message({ id: 'b', at: '2026-10-15T00:00:00.000Z' });
  message({ id: 'a', at: '2026-10-15T00:00:00.000Z' });
  message({ id: 'z', at: '2026-10-16T00:00:00.000Z' });
  expect(notifications.list(owner, wid).items.map((item) => item.id)).toEqual(['z', 'a', 'b']);
});

it('isolates pages and unread summaries by both recipient and workspace, including read notices', () => {
  const own = message({ eventKey: reviewEvent() });
  message({ userId: member.userId, eventKey: reviewEvent({ userId: member.userId }) });
  message({ workspaceId: otherWid, eventKey: reviewEvent({ workspaceId: otherWid }) });
  message({ readAt: createdAt });
  expect(notifications.list(owner, wid)).toMatchObject({
    total: 2,
    unread: { system: 0, review: 1, total: 1 },
  });
  expect(
    notifications.list(owner, wid, { category: 'review' }).items.map((item) => item.id),
  ).toEqual([own]);
  expect(notifications.summary(owner, otherWid)).toEqual({ system: 0, review: 1, total: 1 });
  expect(notifications.summary(member, wid)).toEqual({ system: 0, review: 1, total: 1 });
  expect(notifications.list(member, wid).total).toBe(1);
});

it('classifies null and unknown historical events as system without guessing from their text', () => {
  const historical = [
    null,
    'support:old-event',
    'legacy:appeal:ticket',
    'appeal',
    'appealish:ticket',
    'appeal:unknown-legacy',
    `appeal:${randomUUID()}`,
  ];
  const ids = historical.map((eventKey) =>
    message({ eventKey, title: '审核通过', text: 'appeal: 申诉审核已完成' }),
  );
  const review = message({ eventKey: reviewEvent(), title: '普通消息', text: '没有审核字样' });
  const system = notifications.list(owner, wid, { category: 'system' });
  expect(new Set(system.items.map((item) => item.id))).toEqual(new Set(ids));
  expect(system.items.every((item) => item.category === 'system')).toBe(true);
  expect(
    notifications.list(owner, wid, { category: 'review' }).items.map((item) => item.id),
  ).toEqual([review]);
  expect(notifications.summary(owner, wid)).toEqual({
    system: historical.length,
    review: 1,
    total: historical.length + 1,
  });
});

it('requires a real appeal decision for the same workspace and original ticket recipient', () => {
  const wrongRecipient = message({ eventKey: reviewEvent({ userId: member.userId }) });
  const wrongWorkspace = message({ eventKey: reviewEvent({ workspaceId: otherWid }) });
  const unresolvedId = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO support_tickets(id,workspace_id,created_by,subject,category,message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .run(unresolvedId, wid, owner.userId, '未裁定', 'appeal', '没有审核事实', createdAt, createdAt);
  const unresolved = message({ eventKey: `appeal:${unresolvedId}` });
  expect(notifications.list(owner, wid, { category: 'review' }).total).toBe(0);
  expect(new Set(notifications.list(owner, wid).items.map((item) => item.id))).toEqual(
    new Set([wrongRecipient, wrongWorkspace, unresolved]),
  );
  expect(notifications.summary(owner, wid)).toEqual({ system: 3, review: 0, total: 3 });
});

it('reflects authorized idempotent marking as read without changing total pages or foreign recipients', () => {
  const own = message({ eventKey: reviewEvent() });
  const system = message();
  const foreign = message({
    userId: member.userId,
    eventKey: reviewEvent({ userId: member.userId }),
  });
  const otherSpace = message({ workspaceId: otherWid });
  for (const id of [foreign, otherSpace])
    expect(() => business.readNotification(owner, wid, id)).toThrow('通知不存在');
  expect(notifications.summary(owner, wid)).toEqual({ system: 1, review: 1, total: 2 });
  business.readNotification(owner, wid, own);
  business.readNotification(owner, wid, own);
  expect(notifications.list(owner, wid)).toMatchObject({
    total: 2,
    unread: { system: 1, review: 0, total: 1 },
  });
  business.readNotification(owner, wid, system);
  expect(notifications.summary(owner, wid)).toEqual({ system: 0, review: 0, total: 0 });
  expect(notifications.list(owner, wid, { category: 'review' }).total).toBe(1);
  expect(notifications.summary(member, wid)).toEqual({ system: 0, review: 1, total: 1 });
  expect(notifications.summary(owner, otherWid)).toEqual({ system: 1, review: 0, total: 1 });
});

it('rejects readers without membership and after membership or workspace access is revoked', () => {
  message();
  const reject = (actor: Actor, workspaceId: string) => {
    expect(() => notifications.list(actor, workspaceId)).toThrow('无权访问');
    expect(() => notifications.summary(actor, workspaceId)).toThrow('无权访问');
  };
  reject(stranger, wid);
  reject(member, otherWid);
  db.sqlite
    .prepare('DELETE FROM memberships WHERE workspace_id=? AND user_id=?')
    .run(wid, member.userId);
  reject(member, wid);
  db.sqlite.prepare('UPDATE workspaces SET archived_at=? WHERE id=?').run(createdAt, wid);
  reject(owner, wid);
  expect(() => business.readNotification(owner, wid, 'missing')).toThrow('无权访问');
});

it('keeps the page and full unread summary in one snapshot when another connection writes', async () => {
  message();
  const folder = await mkdtemp(join(tmpdir(), 'yingzao-notification-snapshot-'));
  const file = join(folder, 'fixture.sqlite');
  await db.sqlite.backup(file);
  const reader = createDatabaseContext(file),
    writer = createDatabaseContext(file);
  try {
    migrateDatabase(reader, { migrationsDir: resolve('migrations') });
    migrateDatabase(writer, { migrationsDir: resolve('migrations') });
    const readingContext = new CoreContext(reader, context.config, {}),
      readingService = new NotificationService(readingContext),
      readPage = readingContext.page.bind(readingContext);
    vi.spyOn(readingContext, 'page').mockImplementationOnce((...args) => {
      const page = readPage(...args);
      writer.sqlite
        .prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?)')
        .run(
          randomUUID(),
          wid,
          owner.userId,
          '并发新通知',
          '读取页与汇总期间提交',
          null,
          null,
          createdAt,
        );
      return page;
    });
    expect(readingService.list(owner, wid)).toMatchObject({
      total: 1,
      unread: { system: 1, review: 0, total: 1 },
    });
    expect(readingService.summary(owner, wid)).toEqual({ system: 2, review: 0, total: 2 });
  } finally {
    closeDatabase(reader);
    closeDatabase(writer);
    await rm(folder, { recursive: true, force: true });
  }
});
