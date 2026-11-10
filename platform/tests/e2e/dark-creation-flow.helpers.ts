import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { JobDto } from '../../src/contracts/jobs';
import { expect, type Studio } from './fixtures';
import { openCreationRedesign } from './creation-redesign.helpers';

export async function openDarkFlow(page: Page, studio: Studio, kind = 'image') {
  const opened = await openCreationRedesign(page, studio, { path: `/workbench?kind=${kind}` });
  studio.services.core.auth.update(
    {
      userId: opened.account.user.id,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    { preferences: { theme: 'dark' } },
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(opened.composer).toBeVisible();
  return opened;
}

export async function confirmDarkFlow(page: Page) {
  const response = page.waitForResponse(
    (item) => item.request().method() === 'POST' && new URL(item.url()).pathname === '/api/v1/jobs',
  );
  await page
    .getByRole('dialog', { name: '确认创作', exact: true })
    .getByRole('button', { name: '确认并提交', exact: true })
    .click();
  const accepted = await response;
  expect(accepted.status()).toBe(202);
  return (await accepted.json()).data as JobDto;
}

export async function darkEvidence(studio: Studio, name: string, evidence: unknown) {
  await writeFile(join(studio.folder, `${name}.json`), JSON.stringify(evidence, null, 2));
}
