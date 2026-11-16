import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { AssetDto } from '../../src/contracts/core';
import {
  creativeIntentRequestSchema,
  type CreativeIntentRequest,
} from '../../src/contracts/creative-intent';
import type { JobDto, JobInput } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';

test.use({
  experienceProviders: true,
  experienceImageGateway: false,
  recoveryEnabled: false,
  smsEnabled: false,
});

for (const scenario of ['brand', 'document', 'design-module'] as const) {
  test(`quotes and generates ${scenario} references with a valid capability proof after the server freezes the task input`, async ({
    page,
    studio,
  }) => {
    const account = await studio.experienceSession();
    const headers = { origin: studio.origin, 'x-workspace-id': account.workspace.id };
    await page.context().addCookies([
      {
        name: 'studio_session',
        value: account.sessionToken,
        url: studio.origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    let brandId: string | undefined;
    if (scenario === 'brand') {
      const created = await page.request.post(`${studio.origin}/api/v1/brands`, {
        headers,
        data: {
          name: '能力版本品牌',
          description: '自然植物视觉',
          colors: ['#60836b'],
          referenceAssetIds: [account.reference.id],
        },
      });
      expect(created.status()).toBe(201);
      brandId = (await created.json()).data.id;
    }
    await page.goto(studio.origin);
    const composer = page.locator('.composer[data-presentation="quick"]');
    const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
    await composer
      .getByRole('textbox', { name: '创作需求', exact: true })
      .fill(`本机验证 ${scenario} 引用与有效能力版本，不调用真实模型。`);
    let referenceId = account.reference.id;
    const documentText = '产品：植物精华。容量：30毫升。卖点：轻盈质地和透明玻璃瓶。';
    if (scenario === 'brand') {
      await composer
        .getByRole('combobox', { name: '参考品牌', exact: true })
        .selectOption(brandId!);
    } else if (scenario === 'document') {
      await composer.getByRole('button', { name: '添加素材', exact: true }).click();
      const picker = page.getByRole('dialog', { name: '参考图片、视频或文档', exact: true });
      const selectingFile = page.waitForEvent('filechooser');
      await picker.getByRole('button', { name: '上传', exact: true }).click();
      await (
        await selectingFile
      ).setFiles({
        name: 'proof-document.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(documentText),
      });
      await expect(picker.locator('.upload-row')).toContainText('已保存');
      await picker.getByRole('button', { name: '完成选择', exact: true }).click();
      const assets = await page.request.get(`${studio.origin}/api/v1/assets?q=proof-document`, {
        headers,
      });
      expect(assets.status()).toBe(200);
      const items = (await assets.json()).data.items as AssetDto[];
      expect(items).toHaveLength(1);
      referenceId = items[0]!.id;
      expect(items[0]).toMatchObject({ kind: 'document' });
      // Saving the upload and extracting its text are separate worker stages.
      await expect
        .poll(async () => {
          const extracted = await page.request.get(
            `${studio.origin}/api/v1/assets/${referenceId}`,
            { headers },
          );
          expect(extracted.status()).toBe(200);
          return (await extracted.json()).data.extractionStatus;
        })
        .toBe('ready');
    } else {
      await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
      await settings
        .getByRole('combobox', { name: '创作类型', exact: true })
        .selectOption('marketing');
      await settings.getByRole('button', { name: '完成', exact: true }).click();
      const planner = composer.locator('details.composer-materials');
      await planner.locator('summary').click();
      const modules = planner.locator('.design-module');
      await expect(modules).toHaveCount(3);
      const source = await sharp({
        create: { width: 400, height: 400, channels: 3, background: '#427b61' },
      })
        .png()
        .toBuffer();
      await modules
        .first()
        .locator('input[type=file]')
        .first()
        .setInputFiles({ name: 'proof-module.png', mimeType: 'image/png', buffer: source });
      await expect(modules.first().locator('.asset-chip')).toContainText('proof-module.png');
      const assets = await page.request.get(`${studio.origin}/api/v1/assets?q=proof-module`, {
        headers,
      });
      referenceId = (await assets.json()).data.items[0].id;
    }
    await composer.getByRole('button', { name: '生成图片', exact: true }).click();
    const quote = page.getByRole('dialog', { name: '确认创作', exact: true });
    await expect(quote).toBeVisible();
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/jobs',
    );
    await quote.getByRole('button', { name: '确认并提交', exact: true }).click();
    const accepted = await submitted;
    expect(accepted.status()).toBe(202);
    const job = (await accepted.json()).data as JobDto;
    expect(job.input.capabilityRevision).toBeTruthy();
    const frozen = (
      studio.services.db.sqlite
        .prepare('SELECT input_json FROM job_items WHERE job_id=? ORDER BY item_index')
        .all(job.id) as { input_json: string }[]
    ).map((row) => JSON.parse(row.input_json) as JobInput);
    for (const input of frozen) expect(input.capabilityRevision).toBe(job.input.capabilityRevision);
    let documentAudit: { request: CreativeIntentRequest; compiledPrompt: string } | undefined;
    if (scenario === 'brand') {
      expect(job.input).toMatchObject({ brandId, assetIds: [], referenceAssetIds: [] });
      expect(frozen).toHaveLength(1);
      expect(frozen[0]!.referenceAssetIds).toContain(referenceId);
      expect(frozen[0]!.brandId).toBeUndefined();
    } else if (scenario === 'document') {
      expect(job.input.assetIds).toContain(referenceId);
      expect(frozen).toHaveLength(1);
      expect(frozen[0]!.assetIds).not.toContain(referenceId);
      expect(frozen[0]!.referenceAssetIds).not.toContain(referenceId);
      expect(job.input.creativeBriefId).toBeTruthy();
      const prepared = studio.services.db.sqlite
        .prepare('SELECT state,request_json,compiled_prompt FROM creative_briefs WHERE id=?')
        .get(job.input.creativeBriefId!) as {
        state: string;
        request_json: string;
        compiled_prompt: string;
      };
      expect(prepared).toMatchObject({ state: 'ready' });
      const request = creativeIntentRequestSchema.parse(JSON.parse(prepared.request_json));
      expect(request.rawPrompt).toBe(job.input.prompt);
      expect(request.sourceTexts).toContainEqual({
        id: `document:${referenceId}`,
        text: documentText,
      });
      expect(request.materials).toContainEqual({
        id: referenceId,
        name: 'proof-document.txt',
        kind: 'document',
        role: 'input',
      });
      // The planner sees the complete source. Only its approved compiled result executes;
      // appending the source again could restore facts rejected during clarification.
      expect(prepared.compiled_prompt).toBeTruthy();
      expect(frozen[0]!.prompt).toBe(prepared.compiled_prompt);
      expect(frozen[0]!.referenceText).toBeUndefined();
      expect(frozen[0]!.creativeBriefId).toBeUndefined();
      documentAudit = { request, compiledPrompt: prepared.compiled_prompt };
    } else {
      expect(job.input.assetIds).toEqual([]);
      expect(job.input.options.designs?.[0]?.assetIds).toContain(referenceId);
      expect(frozen).toHaveLength(3);
      expect(frozen[0]!.assetIds).toContain(referenceId);
      expect(frozen.slice(1).every((input) => input.assetIds.length === 0)).toBe(true);
    }
    let completed: JobDto;
    await expect
      .poll(
        async () => {
          const result = await page.request.get(`${studio.origin}/api/v1/jobs/${job.id}`, {
            headers,
          });
          expect(result.status()).toBe(200);
          completed = (await result.json()).data as JobDto;
          return completed.status;
        },
        { timeout: 30000 },
      )
      .toBe('succeeded');
    expect(completed!.outputAssets).toHaveLength(frozen.length);
    const files = [];
    for (const asset of completed!.outputAssets) {
      const response = await page.request.get(new URL(asset.originalUrl, studio.origin).toString());
      expect(response.status()).toBe(200);
      const bytes = await response.body();
      const metadata = await sharp(bytes).metadata();
      expect(metadata.width).toBeGreaterThan(0);
      expect(metadata.height).toBeGreaterThan(0);
      files.push({
        assetId: asset.id,
        byteSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    await expect(page).toHaveURL(new RegExp(`/workbench/${job.projectId}\\?job=${job.id}$`));
    await page.reload();
    await expect(page.locator('.focused-task .job-card')).toBeVisible();
    expect(
      (
        studio.services.db.sqlite
          .prepare('SELECT input_json FROM job_items WHERE job_id=? ORDER BY item_index')
          .all(job.id) as { input_json: string }[]
      ).map((row) => JSON.parse(row.input_json) as JobInput),
    ).toEqual(frozen);
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 1,
    });
    expect(
      studio.services.db.sqlite
        .prepare("SELECT count(*) n FROM credit_ledger WHERE job_id=? AND kind='settle'")
        .get(job.id),
    ).toEqual({ n: frozen.length });
    await writeFile(
      join(studio.folder, `capability-${scenario}-snapshot.json`),
      JSON.stringify(
        { simulated: true, original: job.input, frozen, documentAudit, files },
        null,
        2,
      ),
    );
  });
}
