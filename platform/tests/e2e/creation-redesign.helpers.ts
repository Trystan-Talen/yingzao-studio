import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { AssetDto } from '../../src/contracts/core';
import type { JobDto } from '../../src/contracts/jobs';
import { expect, type Studio } from './fixtures';

export async function openCreationRedesign(
  page: Page,
  studio: Studio,
  options: { path?: string; confirm?: boolean } = {},
) {
  const account = await studio.experienceSession();
  if (options.confirm === false)
    studio.services.core.auth.update(
      {
        userId: account.user.id,
        authType: 'session',
        apiKeyId: null,
        workspaceId: null,
        scopes: [],
      },
      { preferences: { confirmGeneration: false } },
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
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
  });
  await page.goto(`${studio.origin}${options.path ?? '/'}`);
  const composer = page.locator('.composer');
  await expect(composer).toBeVisible();
  return {
    account,
    composer,
    prompt: composer.getByRole('textbox', { name: '创作需求', exact: true }),
    writes,
    headers: { 'x-workspace-id': account.workspace.id },
  };
}

export function creationRecords(studio: Studio) {
  const sql = studio.services.db.sqlite;
  const count = (query: string) => (sql.prepare(query).get() as { n: number }).n;
  return {
    briefs: count('SELECT count(*) n FROM creative_briefs'),
    projects: count('SELECT count(*) n FROM projects'),
    quotes: count('SELECT count(*) n FROM quotes'),
    jobs: count('SELECT count(*) n FROM jobs'),
    reserved: count("SELECT count(*) n FROM credit_ledger WHERE kind='reserve'"),
    settled: count("SELECT count(*) n FROM credit_ledger WHERE kind='settle'"),
  };
}

export async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
}

export async function expectInsideViewport(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  const rect = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(rect).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(-1);
  expect(rect!.y).toBeGreaterThanOrEqual(-1);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

export async function waitForCreationResult(
  page: Page,
  studio: Studio,
  id: string,
  workspaceId: string,
) {
  async function read() {
    const response = await page.request.get(`${studio.origin}/api/v1/jobs/${id}`, {
      headers: { 'x-workspace-id': workspaceId },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data as JobDto;
  }
  await expect.poll(async () => (await read()).status, { timeout: 30_000 }).toBe('succeeded');
  const completed = await read();
  expect(completed.outputAssets).toHaveLength(1);
  expect(completed.items.every((item) => item.status === 'succeeded')).toBe(true);
  return completed;
}

export async function saveAndVerifyCreationOriginal(
  page: Page,
  studio: Studio,
  downloadButton: Locator,
  asset: AssetDto,
  fileName: string,
) {
  const downloading = page.waitForEvent('download');
  await downloadButton.click();
  const file = join(studio.folder, fileName);
  await (await downloading).saveAs(file);
  const downloaded = await readFile(file);
  const response = await page.request.get(new URL(asset.originalUrl, studio.origin).toString());
  expect(response.status()).toBe(200);
  const served = await response.body();
  const original = studio.services.db.sqlite
    .prepare(
      "SELECT a.sha256,a.byte_size,v.storage_key FROM assets a JOIN asset_variants v ON v.asset_id=a.id AND v.variant='original' WHERE a.id=?",
    )
    .get(asset.id) as { sha256: string; byte_size: number; storage_key: string };
  const persisted = await readFile(join(studio.folder, 'media', original.storage_key));
  const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  const sha256 = digest(downloaded);
  expect(sha256).toBe(digest(served));
  expect(sha256).toBe(digest(persisted));
  expect(sha256).toBe(original.sha256);
  expect(downloaded.length).toBe(original.byte_size);
  expect(downloaded.length).toBe(asset.byteSize);
  await writeFile(
    join(studio.folder, `${fileName}.evidence.json`),
    JSON.stringify(
      {
        simulated: true,
        assetId: asset.id,
        jobId: asset.sourceJobId,
        sha256,
        byteSize: downloaded.length,
        downloadedMatchesApiDiskAndDatabase: true,
      },
      null,
      2,
    ),
  );
  return downloaded;
}
