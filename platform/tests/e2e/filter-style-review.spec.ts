import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Locator } from '@playwright/test';
import { jobInputSchema } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';

test.use({ reducedMotion: 'reduce' });

async function filterStyle(button: Locator, theme: 'dark' | 'light') {
  const style = await button.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      radius: parseFloat(computed.borderTopLeftRadius),
      height: element.getBoundingClientRect().height,
      background: computed.backgroundColor,
      color: computed.color,
    };
  });
  expect
    .soft(style.radius, 'A selected filter uses the shared pill shape')
    .toBeGreaterThanOrEqual(style.height / 2);
  expect
    .soft(style.background, 'A selected filter uses the shared selection color')
    .toBe(theme === 'dark' ? 'rgb(244, 241, 234)' : 'rgb(20, 19, 16)');
  expect
    .soft(style.color, 'Selected filter text uses the inverse surface color')
    .toBe(theme === 'dark' ? 'rgb(7, 7, 8)' : 'rgb(243, 240, 233)');
  return style;
}

for (const theme of ['dark', 'light'] as const) {
  test(`task and tool filters retain real filtering with consistent ${theme} selections`, async ({
    page,
    studio,
  }) => {
    const account = await studio.existingIdentitySession();
    studio.services.db.sqlite
      .prepare('UPDATE users SET preferences_json=? WHERE id=?')
      .run(
        JSON.stringify({ ...account.user.preferences, theme, onboardingCompleted: true }),
        account.user.id,
      );
    await page.context().addCookies([
      {
        name: 'studio_session',
        value: account.sessionToken,
        url: studio.origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    // Terminal synthetic records exercise the real list/filter endpoint without generation.
    const ids = { succeeded: randomUUID(), cancelled: randomUUID() };
    const date = new Date().toISOString();
    for (const status of ['succeeded', 'cancelled'] as const) {
      const prompt = status === 'succeeded' ? '筛选验证：已完成示例' : '筛选验证：已取消示例';
      studio.services.db.sqlite
        .prepare(
          "INSERT INTO jobs(id,workspace_id,user_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,settled_credits,created_at,updated_at) VALUES(?,?,?,'image.generate','native',?,?,'filter-fixture',?,'fixture',?,'complete',0,0,?,?)",
        )
        .run(
          ids[status],
          account.workspace.id,
          account.user.id,
          prompt,
          JSON.stringify(
            jobInputSchema.parse({
              operation: 'image.generate',
              providerId: 'native',
              prompt,
              assetIds: [],
              options: {},
            }),
          ),
          randomUUID(),
          status,
          date,
          date,
        );
    }
    await page.goto(`${studio.origin}/tasks`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.task-list-item')).toHaveCount(2);
    const statuses = page.getByLabel('按状态查看任务', { exact: true });
    const completed = statuses.getByRole('button', { name: '已完成', exact: true });
    const response = page.waitForResponse(
      (item) =>
        new URL(item.url()).pathname === '/api/v1/jobs' &&
        new URL(item.url()).searchParams.get('status') === 'succeeded',
    );
    await completed.click();
    expect((await response).status()).toBe(200);
    await expect(completed).toHaveAttribute('aria-pressed', 'true');
    await expect(completed).toBeFocused();
    await expect(page.locator('.task-list-item')).toHaveCount(1);
    await expect(page.locator('.task-list-item [data-job-id]')).toHaveAttribute(
      'data-job-id',
      ids.succeeded,
    );
    const task = await filterStyle(completed, theme);
    await page.screenshot({
      path: `${studio.folder}/task-filter-${theme}.png`,
      fullPage: true,
      scale: 'css',
    });
    await statuses.getByRole('button', { name: '已取消', exact: true }).click();
    await expect(page.locator('.task-list-item [data-job-id]')).toHaveAttribute(
      'data-job-id',
      ids.cancelled,
    );
    await expect(completed).toHaveAttribute('aria-pressed', 'false');
    await statuses.getByRole('button', { name: '全部', exact: true }).click();
    await expect(page.locator('.task-list-item')).toHaveCount(2);

    await page.goto(`${studio.origin}/tools`);
    const categories = page.locator('.tools-page .category-tabs');
    const local = categories.getByRole('button', { name: '本机处理', exact: true });
    await local.click();
    await expect(local).toHaveAttribute('aria-pressed', 'true');
    await expect(local).toBeFocused();
    await expect(page.locator('.tool-card')).toHaveCount(4);
    await expect(page.locator('.tool-card').filter({ hasText: '图片缩放' })).toBeVisible();
    await expect(page.locator('.tool-card').filter({ hasText: '魔法消除' })).toHaveCount(0);
    const tool = await filterStyle(local, theme);
    await page.screenshot({
      path: `${studio.folder}/tool-filter-${theme}.png`,
      fullPage: true,
      scale: 'css',
    });
    await categories.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(local).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.tool-card').filter({ hasText: '魔法消除' })).toBeVisible();
    await expect(page.locator('.tool-card').filter({ hasText: '图片缩放' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await writeFile(
      `${studio.folder}/filter-style-${theme}.json`,
      JSON.stringify({ theme, viewport: page.viewportSize(), task, tool }, null, 2),
    );
  });
}
