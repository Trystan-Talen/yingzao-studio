import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobInput } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

for (const resource of ['project', 'document', 'messages'] as const) {
  for (const cached of [true, false]) {
    test(`${cached ? 'cached' : 'initial'} ${resource} errors preserve the appropriate workbench recovery path`, async ({
      page,
      studio,
    }) => {
      const account = await studio.experienceSession();
      const actor = {
        userId: account.user.id,
        authType: 'session' as const,
        apiKeyId: null,
        workspaceId: null,
        scopes: [],
      };
      const project = studio.services.core.projects.create(actor, account.workspace.id, {
        name: '后台读取失败恢复',
        kind: 'video',
      });
      await page.context().addCookies([
        {
          name: 'studio_session',
          value: account.sessionToken,
          url: studio.origin,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const target = `/api/v1/projects/${project.id}${resource === 'project' ? '' : `/${resource}`}`;
      const errorMessage = `${resource} 后台读取暂不可用`;
      let reject = !cached;
      let rejectAfterSave = false;
      let rejectedRequests = 0;
      await page.route('**/api/v1/projects/**', async (route) => {
        if (
          rejectAfterSave &&
          route.request().method() === 'POST' &&
          new URL(route.request().url()).pathname === `/api/v1/projects/${project.id}/messages`
        )
          reject = true;
        if (
          route.request().method() === 'GET' &&
          new URL(route.request().url()).pathname === target &&
          reject
        ) {
          rejectedRequests++;
          await route.fulfill({
            status: 429,
            json: { error: { code: 'RATE_LIMITED', message: errorMessage } },
          });
        } else await route.continue();
      });
      const preparations: JobInput[] = [];
      const quotes: JobInput[] = [];
      let submissions = 0;
      page.on('request', (request) => {
        if (request.method() !== 'POST') return;
        const path = new URL(request.url()).pathname;
        if (path === '/api/v1/creative-briefs/prepare')
          preparations.push(request.postDataJSON().input as JobInput);
        if (path === '/api/v1/quotes') quotes.push(request.postDataJSON() as JobInput);
        if (path === '/api/v1/jobs') submissions++;
      });
      await page.goto(`${studio.origin}/workbench/${project.id}`);
      const composer = page.locator('.composer');
      const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
      const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
      const original = '月球上的猫，五秒竖屏水彩动画，不加文字。';
      let originalPromptNode: Awaited<ReturnType<typeof prompt.elementHandle>> | null = null;
      let readyId: string | undefined;
      if (cached) {
        await expect(prompt).toBeVisible();
        await prompt.fill(original);
        await composer
          .getByRole('combobox', { name: '发布平台', exact: true })
          .selectOption('TikTok');
        await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
        await settings.getByRole('combobox', { name: '比例', exact: true }).selectOption('9:16');
        await settings.getByRole('button', { name: '完成', exact: true }).click();
        await composer.getByRole('button', { name: '生成视频', exact: true }).click();
        const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
        await expect(confirmation).toBeVisible();
        readyId = quotes[0]!.creativeBriefId;
        expect(readyId).toBeTruthy();
        expect(preparations).toHaveLength(1);
        await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
        await composer.getByText('需求已整理，查看详情', { exact: true }).click();
        await expect(composer.getByText('创作理解', { exact: false })).toBeVisible();
        originalPromptNode = await prompt.elementHandle();
        rejectAfterSave = true;
        // Saving this already prepared draft refreshes cached project queries in the background.
        await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
      }
      const failure = page.getByRole('alert').filter({ hasText: errorMessage });
      await expect(failure).toBeVisible();
      await expect.poll(() => rejectedRequests).toBeGreaterThanOrEqual(2);
      if (cached) {
        await expect(prompt).toBeVisible();
        expect(await originalPromptNode!.evaluate((node) => node.isConnected)).toBe(true);
        await expect(prompt).toHaveValue(original);
        await expect(composer.getByRole('combobox', { name: '发布平台', exact: true })).toHaveValue(
          'TikTok',
        );
        await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
        await expect(settings.getByRole('combobox', { name: '比例', exact: true })).toHaveValue(
          '9:16',
        );
        await settings.getByRole('button', { name: '完成', exact: true }).click();
        await expect(composer.getByText('创作理解', { exact: false })).toBeVisible();
        expect(preparations).toHaveLength(1);
      } else await expect(composer).toHaveCount(0);
      reject = false;
      await failure.getByRole('button', { name: '重试', exact: true }).click();
      await expect(failure).toHaveCount(0);
      await expect(prompt).toBeVisible();
      if (cached) {
        expect(await originalPromptNode!.evaluate((node) => node.isConnected)).toBe(true);
        await expect(prompt).toHaveValue(original);
        await composer.getByRole('button', { name: '生成视频', exact: true }).click();
        const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
        await expect(confirmation).toBeVisible();
        expect(preparations).toHaveLength(1);
        // The still-valid quote belongs to the retained submission state and is reused.
        expect(quotes).toHaveLength(1);
        expect(quotes[0]!.creativeBriefId).toBe(readyId);
        await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
      } else expect(preparations).toHaveLength(0);
      expect(submissions).toBe(0);
      expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
        n: 0,
      });
      expect(
        studio.services.db.sqlite
          .prepare("SELECT count(*) n FROM credit_ledger WHERE kind='settle'")
          .get(),
      ).toEqual({ n: 0 });
      await writeFile(
        join(studio.folder, `workbench-${resource}-${cached ? 'cached' : 'initial'}.json`),
        JSON.stringify(
          { resource, cached, rejectedRequests, preparations, quotes, submissions, readyId },
          null,
          2,
        ),
      );
    });
  }
}
