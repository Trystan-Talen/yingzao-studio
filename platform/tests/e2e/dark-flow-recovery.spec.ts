import { join } from 'node:path';
import type { JobDto } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';
import { confirmDarkFlow, darkEvidence, openDarkFlow } from './dark-creation-flow.helpers';
import {
  creationRecords,
  expectNoHorizontalOverflow,
  waitForCreationResult,
} from './creation-redesign.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

test('dark mobile failure requires an explicitly confirmed separate retry', async ({
  page,
  studio,
}) => {
  const { account, composer, prompt, writes } = await openDarkFlow(page, studio);
  const original = '模拟首次失败：植物精华商品主图。';
  await prompt.fill(original);
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const first = await confirmDarkFlow(page);
  await expect
    .poll(() =>
      studio.services.db.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(first.id),
    )
    .toEqual({ status: 'failed' });
  const focused = page.locator('.focused-task');
  await expect(focused).toContainText('本机模拟首次失败');
  await expect(focused.getByText('这次创作未完成', { exact: true })).toBeVisible();
  await page.reload();
  await expect(focused).toContainText('本机模拟首次失败');
  expect(creationRecords(studio)).toMatchObject({ jobs: 1, reserved: 1 });
  expect(writes.filter((path) => path === '/api/v1/jobs')).toHaveLength(1);
  await page.screenshot({ path: join(studio.folder, 'failed-task-retained.png'), fullPage: true });
  await focused.getByRole('button', { name: '为可重试项重新估价', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(creationRecords(studio)).toMatchObject({ jobs: 1, reserved: 1 });
  const retry = await confirmDarkFlow(page);
  const completed = await waitForCreationResult(page, studio, retry.id, account.workspace.id);
  expect(completed.outputAssets).toHaveLength(1);
  expect(retry.id).not.toBe(first.id);
  expect(
    studio.services.db.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(first.id),
  ).toEqual({ status: 'failed' });
  expect(creationRecords(studio)).toMatchObject({ jobs: 2, reserved: 2 });
  expect(writes.filter((path) => path === '/api/v1/jobs')).toHaveLength(2);
  await page.goto(`${studio.origin}/tasks`);
  await expect(page.locator('.job-card')).toHaveCount(2);
  await expect(page.locator('.job-card').filter({ hasText: '本机模拟首次失败' })).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, 'explicit-retry-and-original-failure.png'),
    fullPage: true,
  });
  await darkEvidence(studio, 'retry-evidence', {
    simulated: true,
    firstJob: first.id,
    retryJob: retry.id,
    originalFailureRetained: true,
    separateQuoteAndConfirmation: true,
    records: creationRecords(studio),
    writes,
  });
});

test('dark desktop display fixture distinguishes paused saving from an unknown outcome', async ({
  page,
  studio,
}) => {
  const { account, composer, prompt, writes } = await openDarkFlow(page, studio);
  await prompt.fill('用于状态展示的植物精华概念图。');
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const accepted = await confirmDarkFlow(page);
  const saved = await waitForCreationResult(page, studio, accepted.id, account.workspace.id);
  let paused = true;
  const display = (): JobDto => ({
    ...saved,
    status: 'reconciliation_required',
    settledCredits: 0,
    stage: paused ? '本机展示夹具：原结果保存已暂停' : '本机展示夹具：提交结果尚待核对',
    updatedAt: new Date(Date.now() + 60_000).toISOString(),
    outputAssets: [],
    errorMessage: paused ? '本机展示夹具：获取原结果中断' : '本机展示夹具：无法确认远端是否已受理',
    items: saved.items.map((item) => ({
      ...item,
      status: 'reconciliation_required',
      assetId: null,
      assetIds: [],
      remoteId: 'local-display-fixture',
      phase: paused ? 'downloading' : 'submitting',
      canResume: paused,
      retryable: false,
      errorMessage: null,
      nextRetryAt: null,
    })),
  });
  // This read-only DTO fixture verifies presentation only, not remote recovery.
  await page.route(/\/api\/v1\/jobs(?:[/?]|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (body.data?.id === saved.id) body.data = display();
    else if (Array.isArray(body.data?.items))
      body.data.items = body.data.items.map((job: JobDto) =>
        job.id === saved.id ? display() : job,
      );
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  const task = page.locator('.focused-task');
  await expect(task.getByText('已收到生成结果，保存已暂停', { exact: true })).toBeVisible();
  await expect(
    task.getByText('继续获取并保存已有结果，不会再次调用模型生成。', { exact: true }),
  ).toBeVisible();
  await expect(task.getByRole('button', { name: '恢复保存作品', exact: true })).toBeVisible();
  await expect(task.locator('.result-progress-details')).not.toHaveAttribute('open');
  await expect(task.getByText('本机展示夹具：获取原结果中断', { exact: true })).toBeVisible();
  await expect(task.getByRole('button', { name: '下载原件', exact: true })).toHaveCount(0);
  await expect(task.getByText('作品已保存', { exact: true })).toHaveCount(0);
  await task.getByText('查看处理阶段', { exact: true }).click();
  await expect(task.locator('.result-server-stage')).toContainText('原结果保存已暂停');
  await page.screenshot({
    path: join(studio.folder, 'display-fixture-paused-saving.png'),
    fullPage: true,
  });
  paused = false;
  await page.reload();
  await expect(task.getByText('执行结果需要核对', { exact: true })).toBeVisible();
  await expect(
    task.getByText('尚无法确认最终结果。请先核对原任务，避免重复生成。', { exact: true }),
  ).toBeVisible();
  await expect(task.getByRole('button', { name: '恢复保存作品', exact: true })).toHaveCount(0);
  await expect(task.getByRole('button', { name: '为可重试项重新估价', exact: true })).toHaveCount(
    0,
  );
  await expect(task.getByRole('button', { name: '下载原件', exact: true })).toHaveCount(0);
  expect(creationRecords(studio)).toMatchObject({ jobs: 1, reserved: 1, settled: 1 });
  expect(writes.filter((path) => path === '/api/v1/jobs')).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, 'display-fixture-unknown-outcome.png'),
    fullPage: true,
  });
  await darkEvidence(studio, 'display-status-evidence', {
    displayFixtureOnly: true,
    remoteRecoveryNotExercised: true,
    fixtureBasedOnLocalJob: saved.id,
    pausedSavingAndUnknownRemainWarnings: true,
    jobsUnchanged: 1,
    writes,
  });
});
