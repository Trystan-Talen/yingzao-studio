import { randomUUID } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import type { Actor } from '../../src/contracts/core';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

async function account(page: Page, studio: Studio) {
  const owner = await studio.existingIdentitySession();
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: owner.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const actor: Actor = {
    userId: owner.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  return { owner, actor };
}

async function notifications(page: Page, studio: Studio) {
  const { owner, actor } = await account(page, studio);
  const other = studio.services.core.auth.createWorkspace(
    actor.userId,
    'Notification isolation space',
    'team',
    false,
  );
  const insert = studio.services.db.sqlite.prepare(
    'INSERT INTO notifications(id,workspace_id,user_id,title,message,event_key,created_at) VALUES(?,?,?,?,?,?,?)',
  );
  for (let index = 1; index <= 25; index++) {
    insert.run(
      randomUUID(),
      owner.workspace.id,
      owner.user.id,
      `当前空间通知 ${index}`,
      `本机真实消息正文 ${index}`,
      `current-notice:${index}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    );
  }
  insert.run(
    randomUUID(),
    other.id,
    owner.user.id,
    '其他空间专有通知',
    '不得混入当前空间',
    'other-space-notice',
    '2026-01-02T00:00:00.000Z',
  );
  await page.goto(studio.origin);
  return { owner, actor, other };
}

test('shows a loading state until the actual isolated notification response arrives', async ({
  page,
  studio,
}) => {
  await notifications(page, studio);
  const matches = (url: URL) =>
    url.origin === studio.origin && url.pathname === '/api/v1/notifications';
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let held = false;
  let ready = false;
  let failure: string | null = null;
  const handler = async (route: Route) => {
    if (held) {
      await route.fallback();
      return;
    }
    held = true;
    try {
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
      ready = true;
      await barrier;
      await route.fulfill({ response });
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Fixture response failed';
      await route.abort('failed').catch(() => undefined);
    } finally {
      finish();
    }
  };
  await page.route(matches, handler);
  try {
    await page.getByRole('button', { name: '通知', exact: true }).click();
    await expect
      .poll(() => {
        if (failure) throw new Error(failure);
        return ready;
      })
      .toBe(true);
    const drawer = page.getByRole('dialog', { name: '通知', exact: true });
    await expect(drawer.getByRole('status').filter({ hasText: '正在加载' })).toBeVisible();
    await expect(drawer.getByText('暂时没有新消息', { exact: true })).toHaveCount(0);
    release();
    await expect(drawer.locator('.notification')).toHaveCount(24);
    await expect(drawer).toContainText('当前空间通知 25');
    await expect(drawer).not.toContainText('其他空间专有通知');
  } finally {
    release();
    if (held) await finished;
    await page.unroute(matches, handler);
  }
});

test('shows one injected notification failure and retries against the real API without an empty-state claim', async ({
  page,
  studio,
}) => {
  await notifications(page, studio);
  const matches = (url: URL) =>
    url.origin === studio.origin && url.pathname === '/api/v1/notifications';
  let failures = 0;
  let realRequests = 0;
  await page.route(matches, async (route) => {
    if (!failures) {
      failures++;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'ISOLATED_NOTIFICATION_FAILURE', message: '隔离通知读取失败' },
        }),
      });
    } else {
      realRequests++;
      await route.fallback();
    }
  });
  await page.getByRole('button', { name: '通知', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '通知', exact: true });
  await expect(drawer.getByRole('alert')).toContainText('隔离通知读取失败');
  await expect(drawer.getByText('暂时没有新消息', { exact: true })).toHaveCount(0);
  expect(failures).toBe(1);
  expect(realRequests).toBe(0);
  await drawer.getByRole('button', { name: '重试', exact: true }).click();
  await expect(drawer.locator('.notification')).toHaveCount(24);
  await expect(drawer).toContainText('当前空间通知 25');
  await expect(drawer).not.toContainText('其他空间专有通知');
  expect(failures).toBe(1);
  expect(realRequests).toBe(1);
});

test('reaches notification 25 through real pagination and preserves read and workspace boundaries', async ({
  page,
  studio,
}) => {
  const { owner, other } = await notifications(page, studio);
  await page.getByRole('button', { name: '通知', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '通知', exact: true });
  await expect(drawer.locator('.notification')).toHaveCount(24);
  await expect(drawer).not.toContainText('其他空间专有通知');
  await expect(drawer.getByText('当前空间通知 1', { exact: true })).toHaveCount(0);
  await drawer.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(drawer.locator('.notification')).toHaveCount(1);
  await expect(drawer.getByText('当前空间通知 1', { exact: true })).toBeVisible();
  await expect(drawer).toContainText('本机真实消息正文 1');
  await expect(drawer).not.toContainText('其他空间专有通知');
  await drawer.getByRole('button', { name: '标为已读', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '标为已读', exact: true })).toHaveCount(0);
  const read = studio.services.db.sqlite
    .prepare('SELECT read_at FROM notifications WHERE workspace_id=? AND event_key=?')
    .get(owner.workspace.id, 'current-notice:1') as { read_at: string | null };
  expect(read.read_at).not.toBeNull();
  await drawer.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(drawer.locator('.notification')).toHaveCount(24);
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  const switched = await page.request.post(
    `${studio.origin}/api/v1/workspaces/${other.id}/activate`,
    { headers: { origin: studio.origin } },
  );
  expect(switched.status()).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: '通知', exact: true }).click();
  await expect(drawer.locator('.notification')).toHaveCount(1);
  await expect(drawer).toContainText('其他空间专有通知');
  await expect(drawer).not.toContainText('当前空间通知');
  await expect(drawer.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0);
  const foreign = studio.services.db.sqlite
    .prepare('SELECT read_at FROM notifications WHERE workspace_id=?')
    .get(other.id) as { read_at: string | null };
  expect(foreign.read_at).toBeNull();
});

test('filters actual review events and keeps unread counts synchronized across category pages and spaces', async ({
  page,
  studio,
}) => {
  const { owner, other } = await notifications(page, studio),
    sql = studio.services.db.sqlite;
  const notification = sql.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?)');
  for (let index = 0; index < 3; index++) {
    const ticket = randomUUID(),
      time = `2026-10-01T00:00:0${index}.000Z`;
    sql
      .prepare(
        "INSERT INTO support_tickets(id,workspace_id,created_by,subject,category,message,job_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'resolved',?,?)",
      )
      .run(
        ticket,
        owner.workspace.id,
        owner.user.id,
        '本机已审核申诉',
        'appeal',
        '测试审核事实',
        randomUUID(),
        time,
        time,
      );
    sql
      .prepare('INSERT INTO support_resolutions VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        ticket,
        owner.workspace.id,
        'approved',
        '已核验的本机夹具',
        'fixture',
        owner.user.id,
        `fixture:${ticket}`,
        0,
        time,
      );
    notification.run(
      randomUUID(),
      owner.workspace.id,
      owner.user.id,
      `真实审核通知 ${index + 1}`,
      '不发起外部审核或付款',
      `appeal:${ticket}`,
      index === 2 ? time : null,
      time,
    );
  }
  notification.run(
    randomUUID(),
    owner.workspace.id,
    owner.user.id,
    '孤立历史审核标题',
    '没有决策事实，应归系统',
    `appeal:${randomUUID()}`,
    null,
    '2026-10-02T00:00:00.000Z',
  );
  await page.reload();
  await expect(page.locator('.notification-count')).toHaveText('28');
  await page.getByRole('button', { name: '通知', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '通知', exact: true });
  await expect(drawer.getByRole('button', { name: '系统消息 · 26', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '审核通知 · 2', exact: true })).toBeVisible();
  await expect(drawer.locator('.notification')).toHaveCount(24);
  await expect(drawer).toContainText('孤立历史审核标题');
  await drawer.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(drawer.locator('.notification')).toHaveCount(2);
  await drawer.getByRole('button', { name: '审核通知 · 2', exact: true }).click();
  await expect(drawer.locator('.notification')).toHaveCount(3);
  await expect(drawer).not.toContainText('孤立历史审核标题');
  const item = drawer
    .locator('.notification')
    .filter({ has: page.getByText('真实审核通知 1', { exact: true }) });
  await item.getByRole('button', { name: '标为已读', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '审核通知 · 1', exact: true })).toBeVisible();
  await expect(drawer.getByRole('status')).toContainText('当前空间未读 27 条');
  await expect(page.locator('.notification-count')).toHaveText('27');
  await page.reload();
  await expect(page.locator('.notification-count')).toHaveText('27');
  await page.request.post(`${studio.origin}/api/v1/workspaces/${other.id}/activate`, {
    headers: { origin: studio.origin, 'x-workspace-id': owner.workspace.id },
  });
  await page.reload();
  await expect(page.locator('.notification-count')).toHaveText('1');
  await page.getByRole('button', { name: '通知', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '系统消息 · 1', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '审核通知 · 0', exact: true })).toBeVisible();
  await expect(drawer.locator('.notification')).toHaveCount(1);
  await expect(drawer).toContainText('其他空间专有通知');
  await expect(drawer).not.toContainText('真实审核通知');
  await page.screenshot({
    path: `${studio.folder}/notifications-category-space-isolation.png`,
    fullPage: true,
  });
});

for (const language of [
  { id: 'en', owner: 'Owner' },
  { id: 'ar', owner: 'المالك' },
] as const) {
  test(`translates ${language.id} team role labels while retaining the actual owner role`, async ({
    page,
    studio,
  }) => {
    const { owner, actor } = await account(page, studio);
    const team = studio.services.core.auth.createWorkspace(
      actor.userId,
      'Role translation team',
      'team',
      false,
    );
    studio.services.core.team.activate(actor, team.id);
    studio.services.core.auth.update(actor, { preferences: { locale: language.id } });
    await page.goto(`${studio.origin}/team`);
    await expect(page.locator('html')).toHaveAttribute('lang', language.id);
    await expect(page.locator('.team-overview')).toContainText(language.owner);
    const row = page.locator('tbody tr').filter({ hasText: owner.user.displayName });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(1)).toHaveText(language.owner);
    expect(
      studio.services.core.auth.listWorkspaces(actor).find((space) => space.id === team.id)?.role,
    ).toBe('owner');
    await page.screenshot({
      path: `${studio.folder}/team-roles-${language.id}.png`,
      fullPage: true,
    });
  });
}
