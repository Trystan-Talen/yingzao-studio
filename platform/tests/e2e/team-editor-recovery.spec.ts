import type { Page } from '@playwright/test';
import type { Actor } from '../../src/contracts/core';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

async function openTeam(page: Page, studio: Studio) {
  const account = await studio.existingIdentitySession();
  const actor: Actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const core = studio.services.core;
  const team = core.auth.createWorkspace(actor.userId, '隔离编辑恢复团队', 'team', false);
  for (const name of ['成员甲', '成员乙']) {
    const email = name === '成员甲' ? 'member-a@example.test' : 'member-b@example.test';
    const invitation = core.team.invite(actor, team.id, { email, role: 'member' });
    await core.auth.register({
      email,
      password: 'IsolatedMember2026!',
      displayName: name,
      inviteToken: new URLSearchParams(new URL(invitation.inviteUrl).hash.slice(1)).get('token')!,
    });
  }
  core.team.activate(actor, team.id);
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${studio.origin}/team`);
  await expect(page.getByRole('heading', { name: team.name, exact: true })).toBeVisible();
  const members = () => core.team.members(actor, team.id, {}).items;
  return {
    actor,
    team,
    memberA: members().find((member) => member.user.displayName === '成员甲')!,
    memberB: members().find((member) => member.user.displayName === '成员乙')!,
    members,
  };
}

async function holdWrite(page: Page, path: string) {
  let release!: () => void;
  let saved!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    saved = resolve;
  });
  await page.route(
    `**/api/v1${path}`,
    async (route) => {
      if (!['POST', 'PATCH'].includes(route.request().method())) return route.continue();
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
      expect(response.ok()).toBe(true);
      saved();
      await barrier;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  return { release, seen };
}

test('a delayed member save preserves subsequent role, nickname and budget edits', async ({
  page,
  studio,
}) => {
  const team = await openTeam(page, studio);
  await page
    .getByRole('row')
    .filter({ hasText: '成员甲' })
    .getByRole('button', { name: '管理' })
    .click();
  const editor = page.getByRole('dialog', { name: '管理成员', exact: true });
  await editor.getByLabel('备注名称', { exact: true }).fill('已提交备注');
  const held = await holdWrite(page, `/members/${team.memberA.id}`);
  try {
    await editor.getByRole('button', { name: '保存成员设置', exact: true }).click();
    await held.seen;
    await editor.getByLabel('备注名称', { exact: true }).fill('后续备注不能丢失');
    await editor.getByRole('combobox', { name: /^成员角色/ }).selectOption('viewer');
    await editor.getByRole('spinbutton', { name: /^额度上限/ }).fill('100');
    held.release();
    await expect(page.getByText('成员设置已保存', { exact: true })).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('备注名称', { exact: true })).toHaveValue('后续备注不能丢失');
    expect(team.members().find((member) => member.id === team.memberA.id)).toMatchObject({
      nickname: '已提交备注',
      role: 'member',
      creditLimit: null,
    });
    await editor.getByRole('button', { name: '保存成员设置', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(team.members().find((member) => member.id === team.memberA.id)).toMatchObject({
      nickname: '后续备注不能丢失',
      role: 'viewer',
      creditLimit: 100,
    });
  } finally {
    held.release();
  }
});

test('a delayed member save cannot close the next member editor', async ({ page, studio }) => {
  const team = await openTeam(page, studio);
  await page
    .getByRole('row')
    .filter({ hasText: '成员甲' })
    .getByRole('button', { name: '管理' })
    .click();
  const editor = page.getByRole('dialog', { name: '管理成员', exact: true });
  await editor.getByLabel('备注名称', { exact: true }).fill('甲提交');
  const held = await holdWrite(page, `/members/${team.memberA.id}`);
  try {
    await editor.getByRole('button', { name: '保存成员设置', exact: true }).click();
    await held.seen;
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    await page
      .getByRole('row')
      .filter({ hasText: '成员乙' })
      .getByRole('button', { name: '管理' })
      .click();
    await editor.getByLabel('备注名称', { exact: true }).fill('乙独立草稿');
    held.release();
    await expect(page.getByText('成员设置已保存', { exact: true })).toBeVisible();
    await expect(editor.getByLabel('备注名称', { exact: true })).toHaveValue('乙独立草稿');
    await editor.getByRole('button', { name: '保存成员设置', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(team.members().find((member) => member.id === team.memberA.id)?.nickname).toBe('甲提交');
    expect(team.members().find((member) => member.id === team.memberB.id)?.nickname).toBe(
      '乙独立草稿',
    );
  } finally {
    held.release();
  }
});

for (const reopen of [false, true])
  test(`a delayed invitation keeps ${reopen ? 'a reopened' : 'an edited'} invitation draft and its one-time result`, async ({
    page,
    studio,
  }) => {
    const team = await openTeam(page, studio);
    await page.getByRole('button', { name: '邀请成员', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '邀请团队成员', exact: true });
    await editor.getByLabel('成员邮箱', { exact: true }).fill('first-invite@example.test');
    const held = await holdWrite(page, '/invitations');
    try {
      await editor.getByRole('button', { name: '创建邀请链接', exact: true }).click();
      await held.seen;
      if (reopen) {
        await editor.getByRole('button', { name: '关闭', exact: true }).click();
        await page.getByRole('button', { name: '邀请成员', exact: true }).click();
      }
      await editor.getByLabel('成员邮箱', { exact: true }).fill('next-invite@example.test');
      await editor.getByRole('combobox', { name: /^加入角色/ }).selectOption('viewer');
      await editor.getByRole('combobox', { name: /^有效期/ }).selectOption('1');
      held.release();
      const result = page.getByRole('dialog', { name: '邀请链接已创建', exact: true });
      await expect(result).toBeVisible();
      await expect(result.getByLabel('成员邮箱', { exact: true })).toHaveValue(
        'first-invite@example.test',
      );
      const url = await result.getByLabel('专属邀请链接', { exact: true }).inputValue();
      expect(new URL(url).origin).toBe(studio.origin);
      expect(new URL(url).hash).toMatch(/^#token=[A-Za-z0-9_-]{43}$/);
      await result.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(editor).toBeVisible();
      await expect(editor.getByLabel('成员邮箱', { exact: true })).toHaveValue(
        'next-invite@example.test',
      );
      await expect(editor.getByRole('combobox', { name: /^加入角色/ })).toHaveValue('viewer');
      await expect(editor.getByRole('combobox', { name: /^有效期/ })).toHaveValue('1');
      const invitations = () =>
        studio.services.core.team.invitations(team.actor, team.team.id, {}).items;
      expect(invitations().filter((item) => item.email.endsWith('-invite@example.test'))).toEqual([
        expect.objectContaining({
          email: 'first-invite@example.test',
          role: 'member',
          consumedAt: null,
        }),
      ]);
      await editor.getByRole('button', { name: '创建邀请链接', exact: true }).click();
      await expect(result).toBeVisible();
      await expect(result.getByLabel('成员邮箱', { exact: true })).toHaveValue(
        'next-invite@example.test',
      );
      expect(await result.getByLabel('专属邀请链接', { exact: true }).inputValue()).not.toBe(url);
      expect(invitations().find((item) => item.email === 'next-invite@example.test')).toMatchObject(
        { role: 'viewer' },
      );
      await result.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(editor).toHaveCount(0);
    } finally {
      held.release();
    }
  });
