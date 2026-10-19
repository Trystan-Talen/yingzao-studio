import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { test, expect } from './fixtures';

test('handles browser file drop and paste, recovers a lost upload response without duplicate assets, and rejects disguised files', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('上传恢复验收');
  await page.getByLabel('邮箱', { exact: true }).fill('upload-recovery@example.test');
  await page.getByLabel(/^密码/).fill('UploadBrowserPassword2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await page.goto(`${studio.origin}/workbench`);
  const picker = page.locator('.composer-materials > .asset-picker');
  const zone = picker.locator('.upload-drop-zone');
  const png = await sharp({
    create: { width: 80, height: 60, channels: 4, background: '#25a17fff' },
  })
    .png()
    .toBuffer();
  const transfer = async (name: string, event: 'drop' | 'paste') => {
    await zone.evaluate(
      (element, payload) => {
        const data = new DataTransfer();
        data.items.add(
          new File([Uint8Array.from(payload.bytes)], payload.name, {
            type: 'image/png',
            lastModified: 1,
          }),
        );
        if (payload.event === 'drop') {
          element.dispatchEvent(
            new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }),
          );
          element.dispatchEvent(
            new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }),
          );
        } else {
          (element as HTMLElement).focus();
          element.dispatchEvent(
            new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
          );
        }
      },
      { bytes: [...png], name, event },
    );
  };
  await transfer('dropped.png', 'drop');
  await expect(picker.locator('.asset-chip')).toHaveCount(1);
  await expect(picker.locator('.asset-chip')).toContainText('dropped.png');
  await expect(zone).toHaveAttribute('aria-busy', 'false');
  let attempts = 0;
  const requests: string[] = [];
  await page.route('**/api/v1/assets/upload', async (route) => {
    attempts++;
    requests.push(route.request().headers()['x-upload-id'] ?? 'missing');
    if (attempts === 1) {
      const accepted = await route.fetch();
      expect(accepted.status()).toBe(201);
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await transfer('pasted-response-lost.png', 'paste');
  const failed = picker.locator('.upload-row').filter({ hasText: 'pasted-response-lost.png' });
  await expect(failed.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get()).toEqual({
    n: 2,
  });
  await failed.getByRole('button', { name: '重试', exact: true }).click();
  await expect(picker.locator('.asset-chip')).toHaveCount(2);
  expect(attempts).toBe(2);
  expect(requests[0]).not.toBe('missing');
  expect(requests[1]).toBe(requests[0]);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get()).toEqual({
    n: 2,
  });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM asset_variants').get()).toEqual({
    n: 6,
  });
  await expect(zone).toHaveAttribute('aria-busy', 'false');
  await page.unroute('**/api/v1/assets/upload');
  await picker.locator('input[type=file]').setInputFiles({
    name: 'disguised.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  const invalid = picker.locator('.upload-row').filter({ hasText: 'disguised.png' });
  await expect(invalid.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get()).toEqual({
    n: 2,
  });
  await page
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('上传重试后的草稿保持两个真实参考');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(picker.locator('.asset-chip')).toHaveCount(2);
  for (const image of await picker.locator('.asset-chip img').all())
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
      )
      .toBe(true);
  const stored = studio.services.db.sqlite.prepare('SELECT sha256 FROM assets').all() as {
    sha256: string;
  }[];
  expect(stored.every((row) => row.sha256 === createHash('sha256').update(png).digest('hex'))).toBe(
    true,
  );
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  await page.screenshot({ path: `${studio.folder}/upload-recovery-restored.png`, fullPage: true });
});
