import type { ProjectDto } from '../../src/contracts/core';
import { test, expect } from './fixtures';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

for (const outcome of ['cancelled', 'failed'] as const) {
  test(`returns an unsubmitted detail-page project to its own editor after a ${outcome} quote`, async ({
    page,
    studio,
  }) => {
    const account = await studio.experienceSession();
    await page.context().addCookies([
      {
        name: 'studio_session',
        value: account.sessionToken,
        url: studio.origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    if (outcome === 'failed')
      await page.route('**/api/v1/detail-pages/plan-quote', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'FIXTURE_UNAVAILABLE', message: '隔离报价暂时不可用' },
          }),
        }),
      );
    await page.goto(`${studio.origin}/detail-pages`);
    const brief = '白色陶瓷杯，保留本次商品信息，暂不提交策划。';
    await page.getByRole('textbox', { name: /^商品信息与创作要求/ }).fill(brief);
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/projects',
    );
    await page.getByRole('button', { name: '开始整套策划', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const project = (await response.json()).data as ProjectDto;
    expect(project.workflow).toBe('detail-page');
    if (outcome === 'cancelled') {
      const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
      await expect(confirmation).toBeHidden();
    } else {
      await expect(
        page.locator('.detail-planning-submit').getByText('隔离报价暂时不可用', { exact: true }),
      ).toBeVisible();
    }
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
    await page.goto(`${studio.origin}/projects`);
    const card = page.locator('.project-card').filter({ hasText: project.name });
    await expect(card.locator('.project-kind-label')).toHaveText('商品详情页');
    const entry = card.getByRole('link', { name: `打开${project.name}`, exact: true });
    await expect(entry).toHaveAttribute('href', `/detail-pages/${project.id}`);
    await entry.click();
    await expect(page).toHaveURL(`${studio.origin}/detail-pages/${project.id}`);
    await expect(page.getByRole('textbox', { name: /^商品信息与创作要求/ })).toHaveValue(brief);
    await expect(
      page
        .getByRole('navigation', { name: '详情页创作流程' })
        .getByRole('button', { name: /准备商品/ }),
    ).toHaveAttribute('aria-current', 'step');
    await page.reload();
    await expect(page.getByRole('textbox', { name: /^商品信息与创作要求/ })).toHaveValue(brief);
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
    await page.screenshot({
      path: `${studio.folder}/detail-project-${outcome}.png`,
      fullPage: true,
    });
  });
}
