import type { Page } from '@playwright/test';
import type { Actor } from '../../src/contracts/core';
import { t } from '../../src/web/lib/i18n';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

async function account(page: Page, studio: Studio) {
  const result = await studio.existingIdentitySession();
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: result.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const actor: Actor = {
    userId: result.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  return { ...result, actor };
}

async function selectWorkspace(page: Page, name: string) {
  const mobile = page.getByRole('button', { name: '展开导航', exact: true });
  if ((page.viewportSize()?.width ?? 1440) <= 960) {
    await expect(mobile).toBeVisible();
    await mobile.click();
  }
  await page
    .getByRole('button', { name: /切换工作空间/ })
    .filter({ visible: true })
    .click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('creates a real read-only API key through the UI, isolates its workspace and immediately revokes it', async ({
  page,
  request,
  studio,
}) => {
  const owner = await account(page, studio);
  const core = studio.services.core;
  const project = core.projects.create(owner.actor, owner.workspace.id, { name: '接口可读项目' });
  const other = core.auth.createWorkspace(owner.user.id, '接口不可跨越空间', 'team', false);
  await page.goto(`${studio.origin}/developer`);
  await page.getByRole('button', { name: '创建 API Key', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: '创建 API Key', exact: true });
  await editor.getByRole('textbox', { name: '密钥名称', exact: true }).fill('隔离只读验收');
  await editor.getByRole('checkbox', { name: 'assets:read', exact: true }).uncheck();
  await editor.getByRole('checkbox', { name: 'jobs:read', exact: true }).uncheck();
  await editor.getByRole('button', { name: '创建密钥', exact: true }).click();
  const reveal = page.getByRole('dialog', { name: '保存你的新密钥', exact: true });
  const secret = (await reveal.locator('.secret-block').textContent())!;
  expect(secret.length).toBeGreaterThan(30);
  const headers = { authorization: `Bearer ${secret}`, 'x-workspace-id': owner.workspace.id };
  const allowed = await request.get(`${studio.origin}/api/v1/projects/${project.id}`, { headers });
  expect(allowed.status()).toBe(200);
  expect((await allowed.json()).data.id).toBe(project.id);
  expect(
    (
      await request.post(`${studio.origin}/api/v1/projects`, {
        headers,
        data: { name: '不应创建' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get(`${studio.origin}/api/v1/projects`, {
        headers: { ...headers, 'x-workspace-id': other.id },
      })
    ).status(),
  ).toBe(403);
  expect((await request.get(`${studio.origin}/api/v1/api-keys`, { headers })).status()).toBe(403);
  await reveal.getByRole('button', { name: '我已妥善保存', exact: true }).click();
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: '隔离只读验收' });
  await expect(row).toContainText('projects:read');
  await expect(page.locator('body')).not.toContainText(secret);
  await row.getByRole('button', { name: '撤销', exact: true }).click();
  await page
    .getByRole('dialog', { name: '撤销 API Key？', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(row).toContainText('已撤销');
  expect(
    (await request.get(`${studio.origin}/api/v1/projects/${project.id}`, { headers })).status(),
  ).toBe(401);
  expect(
    core.projects.list(owner.actor, owner.workspace.id, {}).items.map((item) => item.id),
  ).toEqual([project.id]);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('saves, supplements, reloads and withdraws a support record through actual controls', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  await page.goto(`${studio.origin}/support`);
  await page.getByRole('button', { name: '提交工单', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '提交工单', exact: true });
  await editor.getByRole('combobox', { name: '问题类型', exact: true }).selectOption('feedback');
  await editor.getByRole('textbox', { name: '主题', exact: true }).fill('本地工单完整流程');
  await editor
    .getByRole('textbox', { name: '详细说明', exact: true })
    .fill('仅保存在隔离测试工作空间，不发送给外部客服。');
  await editor.getByRole('button', { name: '提交工单', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: '本地工单完整流程' });
  await expect(row).toContainText('待处理');
  await row.getByRole('button', { name: '查看记录', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '本地工单完整流程', exact: true });
  await detail
    .getByRole('textbox', { name: '补充说明', exact: true })
    .fill('补充步骤与结果，刷新后需要保留。');
  await detail.getByRole('button', { name: '保存补充', exact: true }).click();
  await expect(detail.locator('.conversation-list')).toContainText(
    '补充步骤与结果，刷新后需要保留。',
  );
  await page.reload();
  await page.getByRole('button', { name: '我的工单', exact: true }).click();
  await row.getByRole('button', { name: '查看记录', exact: true }).click();
  await expect(detail.locator('.conversation-list')).toContainText(
    '补充步骤与结果，刷新后需要保留。',
  );
  await detail.getByRole('button', { name: '撤回工单', exact: true }).click();
  await expect(row).toContainText('已撤回');
  await row.getByRole('button', { name: '查看记录', exact: true }).click();
  await expect(detail.getByRole('button', { name: '保存补充', exact: true })).toBeDisabled();
  await expect(detail.getByRole('button', { name: '撤回工单', exact: true })).toBeDisabled();
  const ticket = studio.services.core.business.tickets(owner.actor, owner.workspace.id, {})
    .items[0]!;
  const saved = studio.services.core.business.ticket(owner.actor, owner.workspace.id, ticket.id);
  expect(saved).toMatchObject({ subject: '本地工单完整流程', status: 'withdrawn' });
  expect(saved.replies).toHaveLength(1);
  expect(saved.replies[0]).toMatchObject({ message: '补充步骤与结果，刷新后需要保留。' });
  expect(studio.smtp.messages).toHaveLength(0);
  for (const locale of ['en', 'ar'] as const) {
    studio.services.core.auth.update(owner.actor, { preferences: { locale } });
    await page.reload();
    await page.getByRole('button', { name: t('我的工单', locale), exact: true }).click();
    await expect(row).toContainText(t('反馈', locale));
    await row.getByRole('button', { name: t('查看记录', locale), exact: true }).click();
    await expect(detail).toContainText(t('创建于', locale));
    await expect(detail).toContainText('仅保存在隔离测试工作空间，不发送给外部客服。');
    await expect(detail.locator('.conversation-list')).toContainText(
      '补充步骤与结果，刷新后需要保留。',
    );
  }
});

test('keeps each unsaved support reply attached to its own ticket when changing records', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  for (const subject of ['记录甲', '记录乙'])
    studio.services.core.business.createTicket(owner.actor, owner.workspace.id, {
      subject,
      category: 'feedback',
      message: `${subject}原始说明`,
    });
  await page.goto(`${studio.origin}/support`);
  await page.getByRole('button', { name: '我的工单', exact: true }).click();
  const open = (subject: string) =>
    page
      .getByRole('row')
      .filter({ hasText: subject })
      .getByRole('button', { name: '查看记录', exact: true })
      .click();
  await open('记录甲');
  let detail = page.getByRole('dialog', { name: '记录甲', exact: true });
  await detail
    .getByRole('textbox', { name: '补充说明', exact: true })
    .fill('只属于记录甲的未保存输入');
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await open('记录乙');
  detail = page.getByRole('dialog', { name: '记录乙', exact: true });
  await expect(detail.getByRole('textbox', { name: '补充说明', exact: true })).toHaveValue('');
  await detail
    .getByRole('textbox', { name: '补充说明', exact: true })
    .fill('只属于记录乙的未保存输入');
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await open('记录甲');
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: '补充说明', exact: true }),
  ).toHaveValue('只属于记录甲的未保存输入');
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM ticket_messages').get()).toEqual(
    { n: 0 },
  );
});

test('a delayed support save does not clear newer drafts in either the original or another ticket', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  const first = studio.services.core.business.createTicket(owner.actor, owner.workspace.id, {
    subject: '延迟记录甲',
    category: 'feedback',
    message: '延迟保存原文',
  });
  studio.services.core.business.createTicket(owner.actor, owner.workspace.id, {
    subject: '延迟记录乙',
    category: 'feedback',
    message: '另一记录原文',
  });
  await page.goto(`${studio.origin}/support`);
  await page.getByRole('button', { name: '我的工单', exact: true }).click();
  const open = (subject: string) =>
    page
      .getByRole('row')
      .filter({ hasText: subject })
      .getByRole('button', { name: '查看记录', exact: true })
      .click();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready = false;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route(`**/api/v1/support/tickets/${first.id}/replies`, async (route) => {
    try {
      const response = await route.fetch();
      ready = true;
      await barrier;
      await route.fulfill({ response });
    } finally {
      finish();
    }
  });
  try {
    await open('延迟记录甲');
    const firstDialog = page.getByRole('dialog', { name: '延迟记录甲', exact: true });
    await firstDialog
      .getByRole('textbox', { name: '补充说明', exact: true })
      .fill('已提交的甲补充');
    await firstDialog.getByRole('button', { name: '保存补充', exact: true }).click();
    await expect.poll(() => ready).toBe(true);
    await firstDialog
      .getByRole('textbox', { name: '补充说明', exact: true })
      .fill('提交后新写的甲草稿');
    await firstDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await open('延迟记录乙');
    const secondDialog = page.getByRole('dialog', { name: '延迟记录乙', exact: true });
    await secondDialog
      .getByRole('textbox', { name: '补充说明', exact: true })
      .fill('与甲提交无关的乙草稿');
    release();
    await finished;
    await expect(secondDialog.getByRole('button', { name: '保存补充', exact: true })).toBeEnabled();
    await expect(secondDialog.getByRole('textbox', { name: '补充说明', exact: true })).toHaveValue(
      '与甲提交无关的乙草稿',
    );
    await secondDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await open('延迟记录甲');
    await expect(firstDialog.getByRole('textbox', { name: '补充说明', exact: true })).toHaveValue(
      '提交后新写的甲草稿',
    );
    expect(
      studio.services.core.business
        .ticket(owner.actor, owner.workspace.id, first.id)
        .replies.map((reply) => reply.message),
    ).toEqual(['已提交的甲补充']);
  } finally {
    release();
    if (ready) await finished;
  }
});

for (const reopen of [false, true]) {
  test(`a delayed ticket creation preserves later edits in the ${reopen ? 'reopened' : 'same'} creation dialog`, async ({
    page,
    studio,
  }) => {
    await account(page, studio);
    await page.goto(`${studio.origin}/support`);
    await page.getByRole('button', { name: '提交工单', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '提交工单', exact: true });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready = false;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route('**/api/v1/support/tickets', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      try {
        const response = await route.fetch();
        ready = true;
        await barrier;
        await route.fulfill({ response });
      } finally {
        finish();
      }
    });
    try {
      await dialog.getByRole('textbox', { name: '主题', exact: true }).fill('已提交的工单甲');
      await dialog.getByRole('textbox', { name: '详细说明', exact: true }).fill('甲的提交时说明');
      await dialog.getByRole('button', { name: '提交工单', exact: true }).click();
      await expect.poll(() => ready).toBe(true);
      if (reopen) {
        await dialog.getByRole('button', { name: '关闭', exact: true }).click();
        await page.getByRole('button', { name: '提交工单', exact: true }).first().click();
      }
      await dialog.getByRole('textbox', { name: '主题', exact: true }).fill('未提交的工单乙');
      await dialog
        .getByRole('textbox', { name: '详细说明', exact: true })
        .fill('旧响应不得清空的乙说明');
      await dialog
        .getByRole('combobox', { name: '问题类型', exact: true })
        .selectOption('feedback');
      release();
      await finished;
      await expect(
        page.locator('.toast').filter({ hasText: '工单已保存，状态为待处理' }),
      ).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: '主题', exact: true })).toHaveValue(
        '未提交的工单乙',
      );
      await expect(dialog.getByRole('textbox', { name: '详细说明', exact: true })).toHaveValue(
        '旧响应不得清空的乙说明',
      );
      await expect(dialog.getByRole('combobox', { name: '问题类型', exact: true })).toHaveValue(
        'feedback',
      );
      expect(
        studio.services.db.sqlite
          .prepare('SELECT subject,message,category FROM support_tickets')
          .all(),
      ).toEqual([{ subject: '已提交的工单甲', message: '甲的提交时说明', category: 'support' }]);
      await dialog.getByRole('button', { name: '提交工单', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(
        studio.services.db.sqlite
          .prepare('SELECT subject,message,category FROM support_tickets ORDER BY subject')
          .all(),
      ).toEqual([
        { subject: '已提交的工单甲', message: '甲的提交时说明', category: 'support' },
        { subject: '未提交的工单乙', message: '旧响应不得清空的乙说明', category: 'feedback' },
      ]);
    } finally {
      release();
      if (ready) await finished;
    }
  });
}

test('a delayed withdrawal closes only its submitted ticket and preserves another open record', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  const first = studio.services.core.business.createTicket(owner.actor, owner.workspace.id, {
    subject: '待撤回记录甲',
    category: 'feedback',
    message: '甲原文',
  });
  const second = studio.services.core.business.createTicket(owner.actor, owner.workspace.id, {
    subject: '仍打开记录乙',
    category: 'feedback',
    message: '乙原文',
  });
  await page.goto(`${studio.origin}/support`);
  await page.getByRole('button', { name: '我的工单', exact: true }).click();
  const open = (subject: string) =>
    page
      .getByRole('row')
      .filter({ hasText: subject })
      .getByRole('button', { name: '查看记录', exact: true })
      .click();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready = false;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route(`**/api/v1/support/tickets/${first.id}/withdraw`, async (route) => {
    try {
      const response = await route.fetch();
      ready = true;
      await barrier;
      await route.fulfill({ response });
    } finally {
      finish();
    }
  });
  try {
    await open('待撤回记录甲');
    const firstDialog = page.getByRole('dialog', { name: '待撤回记录甲', exact: true });
    await firstDialog.getByRole('button', { name: '撤回工单', exact: true }).click();
    await expect.poll(() => ready).toBe(true);
    await expect(firstDialog.getByRole('button', { name: '撤回工单', exact: true })).toBeDisabled();
    await firstDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await open('仍打开记录乙');
    const secondDialog = page.getByRole('dialog', { name: '仍打开记录乙', exact: true });
    await secondDialog
      .getByRole('textbox', { name: '补充说明', exact: true })
      .fill('乙记录的新草稿');
    release();
    await finished;
    await expect(page.locator('.toast').filter({ hasText: '工单已撤回' })).toBeVisible();
    await expect(secondDialog).toBeVisible();
    await expect(secondDialog.getByRole('textbox', { name: '补充说明', exact: true })).toHaveValue(
      '乙记录的新草稿',
    );
    expect(
      studio.services.core.business.ticket(owner.actor, owner.workspace.id, first.id).status,
    ).toBe('withdrawn');
    expect(
      studio.services.core.business.ticket(owner.actor, owner.workspace.id, second.id).status,
    ).toBe('open');
  } finally {
    release();
    if (ready) await finished;
  }
});

test('invites a viewer, changes the actual member role and revokes team access while preserving team work', async ({
  page,
  browser,
  studio,
}) => {
  const owner = await account(page, studio);
  const core = studio.services.core;
  const team = core.auth.createWorkspace(owner.user.id, '角色验收团队', 'team', false);
  const privateProject = core.projects.create(owner.actor, owner.workspace.id, {
    name: '不能跨空间读取的项目',
  });
  await page.goto(studio.origin);
  await selectWorkspace(page, team.name);
  await page.goto(`${studio.origin}/team`);
  await page.getByRole('button', { name: '邀请成员', exact: true }).click();
  const invitation = page.getByRole('dialog', { name: '邀请团队成员', exact: true });
  await invitation
    .getByRole('textbox', { name: '成员邮箱', exact: true })
    .fill('viewer-lifecycle@example.test');
  await invitation.getByRole('combobox', { name: '加入角色', exact: true }).selectOption('viewer');
  await invitation.getByRole('button', { name: '创建邀请链接', exact: true }).click();
  const link = page.getByRole('dialog', { name: '邀请链接已创建', exact: true });
  const inviteUrl = await link
    .getByRole('textbox', { name: '专属邀请链接', exact: true })
    .inputValue();
  await link.getByRole('button', { name: '关闭', exact: true }).click();
  const memberContext = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const member = await memberContext.newPage();
    await member.goto(inviteUrl);
    await member.getByLabel('你的称呼', { exact: true }).fill('被邀请的只读成员');
    await member.getByLabel('邮箱', { exact: true }).fill('viewer-lifecycle@example.test');
    await member.getByLabel(/^密码/).fill('ViewerLifecyclePassword2026!');
    await member.getByRole('button', { name: '创建并开始创作', exact: true }).click();
    await member.getByRole('button', { name: '稍后设置', exact: true }).click();
    await selectWorkspace(member, team.name);
    await member.goto(`${studio.origin}/projects`);
    await expect(member.getByRole('button', { name: '新建项目', exact: true })).toHaveCount(0);
    const headers = { origin: studio.origin, 'x-workspace-id': team.id };
    expect(
      (
        await member.request.post(`${studio.origin}/api/v1/projects`, {
          headers,
          data: { name: '只读不可创建' },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await member.request.get(`${studio.origin}/api/v1/projects/${privateProject.id}`, {
          headers,
        })
      ).status(),
    ).toBe(404);
    await page.reload();
    const row = page.getByRole('row').filter({ hasText: 'viewer-lifecycle@example.test' });
    await row.getByRole('button', { name: '管理', exact: true }).click();
    const managing = page.getByRole('dialog', { name: '管理成员', exact: true });
    await managing.getByRole('combobox', { name: '成员角色', exact: true }).selectOption('member');
    await managing.getByRole('textbox', { name: '备注名称', exact: true }).fill('已验证的协作者');
    await managing.getByRole('button', { name: '保存成员设置', exact: true }).click();
    await expect(row).toContainText('已验证的协作者');
    await member.reload();
    await member.getByRole('button', { name: '新建项目', exact: true }).first().click();
    const creating = member.getByRole('dialog', { name: '新建项目', exact: true });
    await creating
      .getByRole('textbox', { name: '项目名称', exact: true })
      .fill('成员创建且移除后保留的项目');
    await creating.getByRole('button', { name: '保存项目', exact: true }).click();
    await expect(member).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
    const projectId = new URL(member.url()).pathname.split('/').at(-1)!;
    await row.getByRole('button', { name: '移除', exact: true }).click();
    await page
      .getByRole('dialog', { name: '移除团队成员？', exact: true })
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await expect(row).toHaveCount(0);
    expect(
      (
        await member.request.get(`${studio.origin}/api/v1/projects/${projectId}`, { headers })
      ).status(),
    ).toBe(403);
    expect(core.projects.get(owner.actor, team.id, projectId).name).toBe(
      '成员创建且移除后保留的项目',
    );
    expect(core.projects.get(owner.actor, owner.workspace.id, privateProject.id).name).toBe(
      '不能跨空间读取的项目',
    );
  } finally {
    await memberContext.close();
  }
});
