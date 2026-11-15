import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

test('releases hidden-tab event streams so six tabs cannot starve navigation and resumes with fresh project data', async ({
  page,
  context,
  studio,
}) => {
  const account = await studio.existingIdentitySession();
  await context.addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  // Chromium's automation pages report every window as visible, even after bringToFront.
  // Drive visibility notifications explicitly, while all six tabs, HTTP/1 sockets,
  // EventSource requests, cache refreshes and resulting network starvation remain real.
  await context.addInitScript(() => {
    let visible = true;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visible ? 'visible' : 'hidden'),
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
    (window as unknown as { setFixtureVisibility(value: boolean): void }).setFixtureVisibility = (
      value,
    ) => {
      visible = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  const active = new Set<ServerResponse>();
  let opened = 0;
  const observe = (request: IncomingMessage, response: ServerResponse) => {
    if (!request.url?.startsWith('/api/v1/job-events?')) return;
    opened++;
    active.add(response);
    response.once('close', () => active.delete(response));
  };
  studio.app.server.on('request', observe);
  const pages: Page[] = [page];
  async function visibility(target: Page, value: boolean) {
    await target.evaluate(
      (visible) =>
        (window as unknown as { setFixtureVisibility(value: boolean): void }).setFixtureVisibility(
          visible,
        ),
      value,
    );
  }
  try {
    for (let index = 0; index < 6; index++) {
      if (index) {
        await visibility(pages[index - 1]!, false);
        pages.push(await context.newPage());
      }
      const current = pages[index]!;
      const connected = current.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/job-events' && response.status() === 200,
      );
      await current.goto(`${studio.origin}/projects`, { waitUntil: 'domcontentloaded' });
      await connected;
    }
    const last = pages.at(-1)!;
    const activeBeforeProbe = active.size;
    const probe = await last.evaluate(async () => {
      const start = performance.now();
      try {
        const response = await fetch('/api/v1/health', { signal: AbortSignal.timeout(2500) });
        return { ok: response.ok, elapsedMs: Math.round(performance.now() - start), error: null };
      } catch (error) {
        return {
          ok: false,
          elapsedMs: Math.round(performance.now() - start),
          error: error instanceof Error ? error.name : String(error),
        };
      }
    });
    await writeFile(
      join(studio.folder, 'multi-tab-event-stream.json'),
      JSON.stringify({ activeBeforeProbe, opened, hiddenTabs: 5, visibleTabs: 1, probe }, null, 2),
    );
    expect(
      probe.ok,
      `Six real tabs must leave a connection for HTTP requests: ${JSON.stringify({ activeBeforeProbe, probe })}`,
    ).toBe(true);
    await expect.poll(() => active.size).toBe(1);
    const headers = { origin: studio.origin, 'x-workspace-id': account.workspace.id };
    const created = await page.request.post(`${studio.origin}/api/v1/projects`, {
      headers,
      data: { name: '隐藏期间新建的项目', kind: 'image' },
    });
    expect(created.status()).toBe(201);
    await visibility(last, false);
    await visibility(page, true);
    await expect(
      page.getByRole('heading', { name: '隐藏期间新建的项目', exact: true }),
    ).toBeVisible();
    await expect.poll(() => active.size).toBe(1);
    const beforeDuplicate = opened;
    await visibility(page, true);
    await visibility(page, true);
    expect(
      await page.evaluate(() => fetch('/api/v1/health').then((response) => response.status)),
    ).toBe(200);
    expect(active.size).toBe(1);
    expect(opened).toBe(beforeDuplicate);
    const events = await page.evaluate(() => document.visibilityState);
    expect(events).toBe('visible');
  } finally {
    await Promise.all(pages.slice(1).map((tab) => tab.close()));
    studio.app.server.removeListener('request', observe);
  }
});
