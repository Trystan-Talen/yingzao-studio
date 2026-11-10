import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { jobInputSchema, type JobDto } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

test('expires a historical retry quote without a model hook and requires a new quote before creating one retry', async ({
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
  const headers = { origin: studio.origin, 'x-workspace-id': account.workspace.id };
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: '模拟首次失败：报价过期后必须重新确认的商品主图。',
    options: {
      model: 'doubao-seedream-5.0-lite',
      ratio: '1:1',
      resolution: '2K',
      format: 'png',
      count: 1,
    },
  });
  const quoted = await page.request.post(`${studio.origin}/api/v1/quotes`, {
    headers,
    data: input,
  });
  expect(quoted.status()).toBe(200);
  const submitted = await page.request.post(`${studio.origin}/api/v1/jobs`, {
    headers,
    data: { input, quoteId: (await quoted.json()).data.id, clientRequestId: randomUUID() },
  });
  expect(submitted.status()).toBe(202);
  const original = (await submitted.json()).data as JobDto;
  await expect
    .poll(() =>
      studio.services.db.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(original.id),
    )
    .toEqual({ status: 'failed' });

  // This page has no Composer/model-capability hook whose timer could incidentally rerender it.
  await page.goto(`${studio.origin}/tasks?job=${original.id}`);
  await expect(page.locator('.composer')).toHaveCount(0);
  const retry = page
    .locator('.focused-task')
    .getByRole('button', { name: '为可重试项重新估价', exact: true });
  await expect(retry).toBeVisible();
  let quotes = 0;
  let browserSubmissions = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/jobs')
      browserSubmissions++;
  });
  await page.route(`**/api/v1/jobs/${original.id}/retry-quote`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    quotes++;
    if (quotes === 1) body.data.expiresAt = new Date(Date.now() + 1000).toISOString();
    await route.fulfill({ response, json: body });
  });
  await retry.click();
  const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
  const confirm = confirmation.getByRole('button', { name: '确认并提交', exact: true });
  await expect(confirm).toBeEnabled();
  // The page's background job poll is 3 seconds; expiry must update before that poll.
  await expect(confirm).toBeDisabled({ timeout: 1800 });
  await expect(confirmation).toContainText('报价已过期，请返回编辑并重新估价。');
  expect(browserSubmissions).toBe(0);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 1 });
  await page.screenshot({ path: join(studio.folder, 'expired-retry-quote.png'), fullPage: true });

  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await retry.click();
  await expect.poll(() => quotes).toBe(2);
  await expect(confirm).toBeEnabled();
  await expect(confirmation.getByText('报价已过期，请返回编辑并重新估价。')).toHaveCount(0);
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/jobs',
  );
  await confirm.click();
  const response = await created;
  expect(response.status()).toBe(202);
  const fresh = (await response.json()).data as JobDto;
  expect(fresh.id).not.toBe(original.id);
  await expect
    .poll(() =>
      studio.services.db.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(fresh.id),
    )
    .toEqual({ status: 'succeeded' });
  expect(browserSubmissions).toBe(1);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 2 });
  expect(
    studio.services.db.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(original.id),
  ).toEqual({ status: 'failed' });
  await writeFile(
    join(studio.folder, 'quote-expiry.json'),
    JSON.stringify(
      { simulated: true, originalJob: original.id, retryJob: fresh.id, quotes, browserSubmissions },
      null,
      2,
    ),
  );
});
