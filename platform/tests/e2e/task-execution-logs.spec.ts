/** Synthetic persisted logs only; queued fixture is held before any provider submission. */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { jobInputSchema } from '../../src/contracts/jobs';
import { createExecutionLogSink } from '../../src/server/tasks/execution-logs';
import {
  emitExecutionAttempt,
  runWithExecutionAudit,
  withExecutionResource,
} from '../../src/server/providers/execution-audit';
import { test, expect, type Studio } from './fixtures';
import { expectNoHorizontalOverflow } from './creation-redesign.helpers';

test.use({
  experienceProviders: true,
  experienceImageGateway: false,
  recoveryEnabled: false,
  smsEnabled: false,
});
async function fixture(page: Page, studio: Studio) {
  const account = await studio.experienceSession();
  const actor = {
    userId: account.user.id,
    authType: 'session' as const,
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  studio.services.core.auth.update(actor, {
    preferences: { theme: 'dark', onboardingCompleted: true },
  });
  const input = jobInputSchema.parse({
    providerId: 'openai',
    operation: 'image.generate',
    prompt: '隔离任务日志测试',
  });
  const job = studio.services.transaction(() => {
    const quote = studio.services.quote(actor, account.workspace.id, input);
    const result = studio.services.submit(
      actor,
      account.workspace.id,
      input,
      quote.id,
      randomUUID(),
    );
    studio.services.db.sqlite
      .prepare('UPDATE job_items SET next_attempt_at=? WHERE job_id=?')
      .run(new Date(Date.now() + 86400000).toISOString(), result.id);
    studio.services.db.sqlite
      .prepare('UPDATE jobs SET created_at=? WHERE id=?')
      .run(new Date(Date.now() - 180000).toISOString(), result.id);
    return result;
  });
  await page
    .context()
    .addCookies([{ name: 'studio_session', value: account.sessionToken, url: studio.origin }]);
  return { account, actor, job };
}

test('administrator can diagnose an unclaimed task and inspect a redacted failed resource call', async ({
  page,
  studio,
}) => {
  const { account, job } = await fixture(page, studio);
  await page.goto(`${studio.origin}/tasks`);
  await expect(page.locator(`[data-job-id="${job.id}"]`)).toContainText('任务仍在排队，等待执行器');
  await page
    .locator(`[data-job-id="${job.id}"]`)
    .getByRole('button', { name: '执行日志', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '管理员任务日志', exact: true });
  await expect(dialog).toContainText('执行器尚未领取');
  await expect(dialog).toContainText('尚无调用记录');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, 'admin-unclaimed-task-log.png'),
    fullPage: true,
  });
  const sink = createExecutionLogSink(studio.services.db, {
    workspaceId: account.workspace.id,
    jobId: job.id,
    itemId: job.items[0]!.id,
    providerId: 'native',
  });
  const secret = 'fixture-private-log-key-9234';
  runWithExecutionAudit(sink, () =>
    withExecutionResource(
      {
        id: 'image-primary',
        name: '图片首选资源',
        kind: 'image',
        baseUrl: 'https://primary.invalid/v1',
        model: 'gpt-image-2',
        protocol: 'openai-images',
      },
      () =>
        emitExecutionAttempt(
          {
            action: 'submit',
            status: 'uncertain',
            httpStatus: 503,
            requestId: 'fixture-request-503',
            message: '服务商暂不可用，提交结果需要核对。',
            metadata: {
              error: { code: 'overloaded', message: `upstream ${secret}` },
              request_id: 'fixture-request-503',
              authorization: secret,
              data: [{ b64_json: 'private-image-data' }],
            },
          },
          [secret],
        ),
    ),
  );
  studio.services.db.sqlite
    .prepare(
      "UPDATE job_items SET status='reconciliation_required',phase='uncertain',attempts=1,error_message='服务商返回错误（503）。' WHERE job_id=?",
    )
    .run(job.id);
  await dialog.getByRole('button', { name: '刷新日志', exact: true }).click();
  await expect(dialog).toContainText('停止自动重发');
  await expect(dialog).toContainText('图片首选资源');
  await expect(dialog).toContainText('503');
  await expect(dialog).toContainText('fixture-request-503');
  await dialog.getByText('上游返回元数据（已脱敏）', { exact: true }).click();
  await expect(dialog).toContainText('overloaded');
  await expect(dialog).toContainText('已隐藏');
  await expect(dialog).not.toContainText(secret);
  await expect(dialog).not.toContainText('private-image-data');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, 'admin-resource-error-metadata.png'),
    fullPage: true,
  });
  expect(
    studio.services.db.sqlite
      .prepare('SELECT attempts FROM job_items WHERE id=?')
      .get(job.items[0]!.id),
  ).toEqual({ attempts: 1 });
});

test('a non-administrator cannot see the entry or read execution metadata directly', async ({
  page,
  studio,
}) => {
  const { account, job } = await fixture(page, studio);
  studio.services.db.sqlite
    .prepare("UPDATE memberships SET role='member' WHERE workspace_id=? AND user_id=?")
    .run(account.workspace.id, account.user.id);
  await page.goto(`${studio.origin}/tasks`);
  const card = page.locator(`[data-job-id="${job.id}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: '执行日志', exact: true })).toHaveCount(0);
  const response = await page.request.get(`${studio.origin}/api/v1/jobs/${job.id}/execution-logs`, {
    headers: { 'x-workspace-id': account.workspace.id },
  });
  expect(response.status()).toBe(403);
  expect(
    studio.services.db.sqlite
      .prepare('SELECT attempts FROM job_items WHERE id=?')
      .get(job.items[0]!.id),
  ).toEqual({ attempts: 0 });
});
