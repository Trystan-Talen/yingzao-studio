import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Actor } from '../../src/contracts/core';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

test('never flashes the previous account private memory or products after an expired session in the same workspace', async ({
  page,
  studio,
}) => {
  test.setTimeout(90_000);
  async function openProducts() {
    const navigation = page.getByRole('button', { name: '展开导航', exact: true });
    if (await navigation.isVisible()) await navigation.click();
    await page.getByRole('link', { name: '产品库', exact: true }).click();
  }
  const owner = await studio.existingIdentitySession();
  const core = studio.services.core;
  const sql = studio.services.db.sqlite;
  const actor = (userId: string): Actor => ({
    userId,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  });
  const a = actor(owner.user.id);
  const workspace = core.auth.createWorkspace(a.userId, '隔离缓存测试团队', 'team');
  const password = 'KnowledgeSecondAccount2026!';
  const invite = core.team.invite(a, workspace.id, {
    email: 'knowledge-second@example.test',
    role: 'member',
  });
  const member = await core.auth.register({
    email: 'knowledge-second@example.test',
    password,
    displayName: '第二测试账户',
    inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
  });
  for (const userId of [a.userId, member.user.id])
    sql
      .prepare(
        "UPDATE users SET active_workspace_id=?,preferences_json=json_set(preferences_json,'$.onboardingCompleted',json('true')) WHERE id=?",
      )
      .run(workspace.id, userId);
  const aMemory = '账户甲私密记忆只允许甲看见';
  const aProduct = '账户甲私密产品只允许甲看见';
  const bMemory = '账户乙自己的创作偏好';
  const bProduct = '账户乙自己的产品';
  core.knowledge.createMemory(a, workspace.id, {
    topic: '甲背景',
    content: aMemory,
    kind: 'profile',
  });
  core.knowledge.createProduct(a, workspace.id, { name: aProduct, visibility: 'private' });
  core.knowledge.createMemory(actor(member.user.id), workspace.id, {
    topic: '乙偏好',
    content: bMemory,
    kind: 'preference',
  });
  core.knowledge.createProduct(actor(member.user.id), workspace.id, {
    name: bProduct,
    visibility: 'private',
  });
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: owner.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${studio.origin}/settings?tab=memory`);
  await expect(page.getByText(aMemory, { exact: true })).toBeVisible();
  await openProducts();
  await expect(page.getByRole('heading', { name: aProduct, exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText(aMemory, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '个人偏好', exact: true }).click();

  // Let the real settings write succeed, then expire A's session before the UI's
  // following refreshSession GET. No reload or explicit signOut clears the cache.
  await page.route('**/api/v1/auth/me', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    sql
      .prepare('UPDATE sessions SET revoked_at=? WHERE user_id=?')
      .run(new Date().toISOString(), a.userId);
    await route.fulfill({ response });
  });
  const expired = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/auth/me' &&
      response.request().method() === 'GET' &&
      response.status() === 401,
  );
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expired;
  await expect(page.getByRole('button', { name: '登录工作空间', exact: true })).toBeVisible();
  await page.evaluate(
    (privateWords) => {
      const state = window as typeof window & {
        knowledgeLeaks: string[];
        knowledgeNavigationMarker: string;
      };
      state.knowledgeLeaks = [];
      state.knowledgeNavigationMarker = 'same-document';
      const inspect = (text: string) => {
        for (const word of privateWords)
          if (text.includes(word) && !state.knowledgeLeaks.includes(word))
            state.knowledgeLeaks.push(word);
      };
      new MutationObserver((records) => {
        for (const record of records) {
          for (const added of record.addedNodes) inspect(added.textContent ?? '');
          if (record.type === 'characterData') inspect(record.target.textContent ?? '');
        }
        inspect(document.body.textContent ?? '');
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    },
    [aMemory, aProduct],
  );

  let releaseMemory!: () => void;
  let releaseProducts!: () => void;
  let sawMemory!: () => void;
  let sawProducts!: () => void;
  const memoryGate = new Promise<void>((resolve) => {
    releaseMemory = resolve;
  });
  const productsGate = new Promise<void>((resolve) => {
    releaseProducts = resolve;
  });
  const memoryRequested = new Promise<void>((resolve) => {
    sawMemory = resolve;
  });
  const productsRequested = new Promise<void>((resolve) => {
    sawProducts = resolve;
  });
  await page.route('**/api/v1/memories?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('pageSize') !== '24')
      return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain(aMemory);
    sawMemory();
    await memoryGate;
    await route.fulfill({ response });
  });
  await page.route('**/api/v1/products?**', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain(aProduct);
    sawProducts();
    await productsGate;
    await route.fulfill({ response });
  });
  try {
    await page.getByLabel('邮箱', { exact: true }).fill(member.user.email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录工作空间', exact: true }).click();
    await expect(page.getByRole('main')).toBeVisible();
    const session = (await (await page.request.get(`${studio.origin}/api/v1/auth/me`)).json()).data;
    expect(session.user.id).toBe(member.user.id);
    expect(session.activeWorkspaceId).toBe(workspace.id);
    // Login replaced the profile URL with home. Back returns to the cached memory
    // page through the SPA router, while B's fresh response is deliberately held.
    await page.goBack();
    await expect(page).toHaveURL(`${studio.origin}/settings?tab=memory`);
    await memoryRequested;
    const leakedMemoryDuringLoad = await page.getByText(aMemory, { exact: true }).count();
    releaseMemory();
    await expect(page.getByText(bMemory, { exact: true })).toBeVisible();
    await openProducts();
    await productsRequested;
    const leakedProductDuringLoad = await page
      .getByRole('heading', { name: aProduct, exact: true })
      .count();
    releaseProducts();
    await expect(page.getByRole('heading', { name: bProduct, exact: true })).toBeVisible();
    const evidence = await page.evaluate(() => {
      const state = window as typeof window & {
        knowledgeLeaks: string[];
        knowledgeNavigationMarker: string;
      };
      return {
        leakedWords: state.knowledgeLeaks,
        navigationMarker: state.knowledgeNavigationMarker,
      };
    });
    await writeFile(
      join(studio.folder, 'knowledge-session-isolation.json'),
      JSON.stringify(
        {
          realSessionExpiryStatus: 401,
          sameWorkspace: true,
          serverResponsesExcludedOtherUserData: true,
          leakedMemoryDuringLoad,
          leakedProductDuringLoad,
          ...evidence,
        },
        null,
        2,
      ),
    );
    expect(evidence.navigationMarker).toBe('same-document');
    expect(
      evidence.leakedWords,
      'No transient rendering of A private information after B signs in',
    ).toEqual([]);
    expect(leakedMemoryDuringLoad).toBe(0);
    expect(leakedProductDuringLoad).toBe(0);
  } finally {
    releaseMemory();
    releaseProducts();
  }
});
