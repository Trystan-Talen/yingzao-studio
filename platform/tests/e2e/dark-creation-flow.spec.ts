import { join } from 'node:path';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CapabilitiesDto, QuoteDto } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';
import { confirmDarkFlow, darkEvidence, openDarkFlow } from './dark-creation-flow.helpers';
import {
  creationRecords,
  expectInsideViewport,
  expectNoHorizontalOverflow,
  saveAndVerifyCreationOriginal,
  waitForCreationResult,
} from './creation-redesign.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

for (const kind of ['image', 'video'] as const) {
  test(`dark ${kind} clarification, authoritative quote, single saved original and reload`, async ({
    page,
    studio,
  }) => {
    const { account, composer, prompt, writes, headers } = await openDarkFlow(page, studio, kind);
    let expectedCredits: number | undefined;
    if (kind === 'video') {
      const response = await page.request.get(`${studio.origin}/api/v1/capabilities`, { headers });
      const caps = (await response.json()).data as CapabilitiesDto;
      const rate = caps.operations.find(
        (op) => op.id === 'video.generate' && op.providerId === 'seedance',
      )!;
      expect(rate.unit).toBe('second');
      expectedCredits = rate.priceCredits * 5;
      await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
      const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
      await settings
        .getByRole('combobox', { name: '生成模型', exact: true })
        .selectOption('video.generate|seedance|doubao-seedance-2.0');
      await settings.getByRole('combobox', { name: '时长', exact: true }).selectOption('5');
      await settings.getByRole('combobox', { name: '比例', exact: true }).selectOption('9:16');
      await settings.getByRole('button', { name: '完成', exact: true }).click();
      await composer.getByRole('checkbox', { name: '生成视频音轨', exact: true }).uncheck();
      await expect(composer.locator('.credit-estimate-value')).toHaveText(
        `预计 ${expectedCredits} 积分`,
      );
    }
    expect(writes).toEqual([]);
    const original = kind === 'image' ? '帮我做个高级一点' : '帮我生成视频';
    const answerText =
      kind === 'image'
        ? '清晨窗边的青绿色香氛概念瓶，完整瓶身，无人物，不添加文字。'
        : '清晨窗边青绿色香氛概念瓶，固定机位，无人物，不添加文字，无音轨。';
    await prompt.fill(original);
    const generate = composer.getByRole('button', {
      name: kind === 'image' ? '生成图片' : '生成视频',
      exact: true,
    });
    await generate.click();
    const brief = page.getByRole('region', { name: '创作需求检查', exact: true });
    const answer = brief.getByRole('textbox', { name: '画面里主要展示什么？', exact: true });
    const next = composer.getByRole('button', { name: '补充完成，继续', exact: true });
    await expect(answer).toBeVisible();
    await next.click();
    await expect(brief.getByRole('alert')).toHaveText('请先回答这一题。');
    await expect(answer).toBeFocused();
    expect(writes.filter((path) => path === '/api/v1/creative-briefs/prepare')).toHaveLength(1);
    expect(creationRecords(studio)).toMatchObject({ briefs: 1, quotes: 0, jobs: 0, reserved: 0 });
    await answer.fill(answerText);
    await page.reload();
    await expect(prompt).toHaveValue(original);
    await expect(answer).toHaveValue(answerText);
    expect(writes.filter((path) => path === '/api/v1/creative-briefs/prepare')).toHaveLength(1);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: join(studio.folder, `${kind}-clarification-restored.png`),
      fullPage: true,
    });
    const quoting = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/quotes',
    );
    await next.click();
    const quoted = await quoting;
    expect(quoted.status()).toBe(200);
    const quote = (await quoted.json()).data as QuoteDto;
    const dialog = page.getByRole('dialog', { name: '确认创作', exact: true });
    const summary = dialog.getByRole('region', { name: '本次创作确认', exact: true });
    await expect(summary).toContainText(original);
    await expect(summary).toContainText(answerText);
    await expect(summary.locator('.media-quote-price strong')).toHaveText(String(quote.maxCredits));
    if (expectedCredits !== undefined) {
      expect(quote.maxCredits).toBe(expectedCredits);
      await expect(dialog.locator('.media-quote-specs')).toContainText('9:16');
      await expect(dialog.locator('.media-quote-specs')).toContainText('5 秒');
    }
    await expect(dialog.locator('.media-quote-details')).not.toHaveAttribute('open');
    await expectInsideViewport(summary, page);
    await expectInsideViewport(
      dialog.getByRole('button', { name: '确认并提交', exact: true }),
      page,
    );
    expect(creationRecords(studio)).toMatchObject({
      briefs: 2,
      quotes: 1,
      jobs: 0,
      reserved: 0,
      settled: 0,
    });
    await page.screenshot({
      path: join(studio.folder, `${kind}-confirmation.png`),
      fullPage: true,
    });
    await dialog.getByText('查看详细配置与计费', { exact: true }).click();
    await expect(dialog.locator('.studio-quote-original')).toContainText(original);
    await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(prompt).toHaveValue(original);
    await generate.click();
    await expect(dialog).toBeVisible();
    expect(writes.filter((path) => path === '/api/v1/creative-briefs/prepare')).toHaveLength(2);
    const accepted = await confirmDarkFlow(page);
    const completed = await waitForCreationResult(page, studio, accepted.id, account.workspace.id);
    expect(completed.input.prompt).toBe(original);
    const frozen = studio.services.db.sqlite
      .prepare('SELECT input_json, compiled_prompt, result_json FROM creative_briefs WHERE id=?')
      .get(completed.input.creativeBriefId!) as {
      input_json: string;
      compiled_prompt: string;
      result_json: string;
    };
    expect(JSON.parse(frozen.input_json).prompt).toBe(original);
    expect(frozen.compiled_prompt).toContain(original);
    expect(frozen.compiled_prompt).toContain(answerText);
    const asset = completed.outputAssets[0]!;
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const task = page.locator('.focused-task');
    await expect(task.locator('.job-card')).toHaveAttribute('data-job-id', accepted.id);
    if (kind === 'image') {
      const image = task.getByRole('img', { name: asset.name, exact: true });
      await expect(image).toBeVisible();
      await image.scrollIntoViewIfNeeded();
      expect(
        await image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0),
      ).toBe(true);
      await task.getByRole('button', { name: `查看 ${asset.name}`, exact: true }).click();
      const details = page.getByRole('dialog', { name: '任务详情', exact: true });
      await expect(details.getByRole('img', { name: asset.name, exact: true })).toBeVisible();
      await expect(details.locator('.result-specs')).not.toHaveAttribute('open');
      await page.screenshot({
        path: join(studio.folder, 'image-preview-dialog.png'),
        fullPage: true,
      });
      await details.getByRole('button', { name: '关闭', exact: true }).click();
    } else {
      expect(completed.input.options.generateAudio).toBe(false);
      expect(asset).toMatchObject({ kind: 'video', width: 720, height: 1280, durationMs: 5000 });
      const video = task.locator('video');
      await expect(video).toBeVisible();
      await video.scrollIntoViewIfNeeded();
      await expect(video).toHaveAttribute('src', asset.originalUrl);
      await expect(video).toHaveAttribute('controls', '');
      await expect(video).toHaveAttribute('playsinline', '');
      await expect(video).not.toHaveAttribute('autoplay');
      await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.duration)).toBe(5);
      await video.evaluate(async (node: HTMLVideoElement) => {
        node.muted = true;
        await node.play();
      });
      await expect
        .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
        .toBeGreaterThan(0.2);
      await video.evaluate((node: HTMLVideoElement) => node.pause());
    }
    await page.screenshot({ path: join(studio.folder, `${kind}-saved.png`), fullPage: true });
    const bytes = await saveAndVerifyCreationOriginal(
      page,
      studio,
      task.getByRole('button', { name: '下载原件', exact: true }),
      asset,
      `dark-${kind}.${kind === 'image' ? 'png' : 'mp4'}`,
    );
    if (kind === 'image')
      expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'png',
        width: 960,
        height: 960,
      });
    else {
      const originalPath = join(studio.folder, 'dark-video.mp4');
      const execute = promisify(execFile);
      const probe = await execute('ffprobe', [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        originalPath,
      ]);
      const metadata = JSON.parse(probe.stdout) as {
        streams: Array<{ codec_type: string; width?: number; height?: number }>;
        format: { duration: string };
      };
      expect(metadata.streams.filter((stream) => stream.codec_type === 'audio')).toHaveLength(0);
      expect(metadata.streams.filter((stream) => stream.codec_type === 'video')).toEqual([
        expect.objectContaining({ width: 720, height: 1280 }),
      ]);
      expect(Number(metadata.format.duration)).toBe(5);
      const decoded = await execute('ffmpeg', [
        '-v',
        'error',
        '-xerror',
        '-i',
        originalPath,
        '-f',
        'null',
        '-',
      ]);
      expect(decoded.stderr).toBe('');
      await darkEvidence(studio, 'video-decode', {
        simulated: true,
        metadata,
        fullDecode: true,
        audioStreams: 0,
      });
    }
    await task.getByRole('button', { name: '作为参考', exact: true }).click();
    if (kind === 'image') {
      await expect(prompt).toBeFocused();
      await expect(prompt).toHaveValue(original);
      await expect(
        composer.getByRole('button', { name: `移除${asset.name}`, exact: true }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText('当前模型仅支持文字生成，请先选择支持参考图的模型。', { exact: true }),
      ).toBeVisible();
    }
    expect(creationRecords(studio)).toMatchObject({ jobs: 1, reserved: 1, settled: 1 });
    const ledger = studio.services.db.sqlite
      .prepare('SELECT kind,amount FROM credit_ledger WHERE job_id=? ORDER BY kind')
      .all(accepted.id);
    expect(ledger).toEqual([
      { kind: 'reserve', amount: quote.maxCredits },
      { kind: 'settle', amount: quote.maxCredits },
    ]);
    expect(writes.filter((path) => path === '/api/v1/jobs')).toHaveLength(1);
    await expectNoHorizontalOverflow(page);
    await darkEvidence(studio, 'dark-flow', {
      simulated: true,
      kind,
      jobId: accepted.id,
      assetId: asset.id,
      original,
      answer: answerText,
      quoteCredits: quote.maxCredits,
      ledger,
      records: creationRecords(studio),
      writes,
      frozenPromptIncludesOriginalAndAnswer: true,
      restoredSameTask: true,
      videoPlayback: kind === 'video' ? 'currentTime advanced above 0.2s' : null,
    });
  });
}
