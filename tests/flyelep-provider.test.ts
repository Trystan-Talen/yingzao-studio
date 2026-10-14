/** Contracts transcribed from official Markdown snapshots in research/public-api-docs. No live requests. */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { jobInputSchema } from '../src/contracts/jobs';
import { flyelepProvider } from '../src/server/providers/flyelep';
import { providerJson } from '../src/server/providers/http';
import type { ExecutionContext } from '../src/server/tasks/types';
import { createServices } from '../src/server/app';
import { closeDatabase } from '../src/server/db/connection';
import type { AppConfig } from '../src/server/config';
vi.mock('../src/server/providers/http', () => ({ providerJson: vi.fn() }));
const call = vi.mocked(providerJson),
  base = 'https://www.flyelep.cn/prod-api/poster-design/api/v1/',
  key = 'fixture-NOT-A-REAL-FLYELEP-KEY',
  output = 'https://media.example.com/confirmed-result.png';
const signed = (id: string, variant = 'original') =>
  `https://studio.example.com/provider-media/${id}?variant=${variant}&signature=contract-fixture`;
beforeEach(() => {
  vi.clearAllMocks();
  call.mockResolvedValue({
    code: 200,
    result: { fileUrlList: [output], taskId: '90071992547409931234' },
  });
});
function context(raw: unknown, files: Record<string, Buffer> = {}): ExecutionContext {
  return {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      workspaceId: null,
      apiKeyId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: jobInputSchema.parse({ providerId: 'flyelep', ...(raw as Record<string, unknown>) }),
    assetUrl: signed,
    readAsset: async (id) => {
      if (!files[id]) throw new Error('Missing contract fixture');
      return { buffer: files[id]!, mimeType: 'image/png', name: 'fixture.png' };
    },
  };
}
function requestBody() {
  return call.mock.calls.at(-1)![1]!.body as Record<string, unknown>;
}
describe('official Flyelep image task protocol (510592991/993/990/510593005)', () => {
  it('submits a string task ID with secretKey header and canonical poster parameters', async () => {
    const source = randomUUID(),
      reference = randomUUID(),
      taskId = '90071992547409931234';
    call.mockResolvedValue({ code: 200, data: taskId });
    const result = await flyelepProvider.execute(
      context({
        operation: 'image.generate',
        prompt: '保留商品包装',
        assetIds: [source],
        referenceAssetIds: [reference],
        options: {
          kind: 'white-background',
          platform: 'Amazon',
          language: 'en',
          ratio: '4:5',
          needText: true,
          channel: 'premium',
        },
      }),
      key,
    );
    expect(result).toEqual({ state: 'submitted', remote: { id: taskId, endpoint: 'image' } });
    expect(call).toHaveBeenCalledWith(
      base + 'poster/generateAsync',
      expect.objectContaining({ headers: { secretKey: key }, submission: true, timeoutMs: 900000 }),
    );
    expect(requestBody()).toMatchObject({
      generateType: 101,
      query: '保留商品包装',
      detailPictureNumber: 1,
      posterType: 5,
      platformType: 'amazon',
      languageType: '英文',
      modelEdition: 9,
      needText: true,
      aspectRatio: '4:5',
      fileUrlList: [signed(source), signed(reference)],
      channel: 'premium',
    });
    expect(requestBody()).not.toHaveProperty('secretKey');
  });
  it.each([
    ['zh-CN', '中文简体'],
    ['zh-TW', '中文繁体'],
    ['en', '英文'],
    ['ja', '日语'],
    ['ar', '阿拉伯语'],
    ['fr', '法语'],
  ])('maps %s into the officially documented language name', async (language, expected) => {
    call.mockResolvedValue({ code: 200, data: 'image-task' });
    await flyelepProvider.execute(
      context({ operation: 'image.generate', options: { language, needText: true } }),
      key,
    );
    expect(requestBody().languageType).toBe(expected);
  });
  it('reads nested replica task IDs and sends comma-separated references and string modelType', async () => {
    const source = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    call.mockResolvedValue({ code: 200, data: { agentGenerateTaskId: '90071992547409935555' } });
    expect(
      await flyelepProvider.execute(
        context({
          operation: 'image-replica',
          assetIds: [source],
          referenceAssetIds: [a, b],
          prompt: '保留本商品',
          options: { ratio: '16:9', language: 'zh-CN', needText: false },
        }),
        key,
      ),
    ).toMatchObject({ state: 'submitted', remote: { id: '90071992547409935555' } });
    expect(call.mock.calls[0]![0]).toBe(base + 'aiTool/generateHotImage');
    expect(requestBody()).toEqual({
      sourceUrl: signed(source),
      replaceUrl: `${signed(a)},${signed(b)}`,
      prompt: '保留本商品',
      ratio: '16:9',
      language: '无文本',
      modelType: '9',
    });
  });
  it('accepts only explicit completed task state and keeps task ID as a string', async () => {
    call.mockResolvedValue({
      code: 200,
      data: { status: 2, taskList: [{ taskStatus: 2, executeResult: output }] },
    });
    expect(
      await flyelepProvider.poll!({ id: '90071992547409935555', endpoint: 'image' }, key),
    ).toMatchObject({ state: 'complete', outputs: [{ url: output, mimeType: 'image/png' }] });
    expect(call.mock.calls[0]![0]).toBe(base + 'poster/queryTaskResult');
    expect(requestBody()).toEqual({ agentGenerateTaskId: '90071992547409935555' });
    expect(call.mock.calls[0]![1]!.headers).toEqual({ secretKey: key });
  });
  it.each([
    { status: 1, state: 'running' },
    { status: 3, state: 'failed' },
  ])(
    'maps official status $status without inferring success from taskList',
    async ({ status, state }) => {
      call.mockResolvedValue({
        code: 200,
        data: { status, taskList: [{ taskStatus: 2, executeResult: output }] },
      });
      expect(await flyelepProvider.poll!({ id: 'task' }, key)).toMatchObject({ state });
    },
  );
  it.each([0, 4, 5, 99])(
    'refuses unknown/partial state %i even when some outputs exist',
    async (status) => {
      call.mockResolvedValue({
        code: 200,
        data: {
          status,
          taskList: [
            { taskStatus: 2, executeResult: output },
            { taskStatus: 3, executeResult: 'one input failed' },
          ],
        },
      });
      await expect(flyelepProvider.poll!({ id: 'task' }, key)).rejects.toMatchObject({
        ambiguous: true,
      });
    },
  );
  it('does not interpret failure reasons or malformed success payloads as media results', async () => {
    call.mockResolvedValue({
      code: 200,
      data: { status: 2, taskList: [{ taskStatus: 3, executeResult: 'generation failed' }] },
    });
    await expect(flyelepProvider.poll!({ id: 'task' }, key)).rejects.toThrow();
    call.mockResolvedValue({ code: 200, data: { status: 2 } });
    await expect(flyelepProvider.poll!({ id: 'task' }, key)).rejects.toThrow();
    call.mockResolvedValue({ code: 200, data: 9007199254740992 });
    await expect(
      flyelepProvider.execute(context({ operation: 'image.generate' }), key),
    ).rejects.toMatchObject({ ambiguous: true });
  });
});
describe('documented synchronous tools', () => {
  it('uses mainImageTagging synchronously and reads result.fileUrlList rather than a task submission (521061418)', async () => {
    const source = randomUUID(),
      reference = randomUUID();
    call.mockResolvedValue({
      code: 200,
      data: ['https://legacy.example.com/ignored.png'],
      result: { fileUrlList: [output], taskId: 'tagging-audit-task' },
    });
    const result = await flyelepProvider.execute(
      context({
        operation: 'product-tagging',
        assetIds: [source],
        referenceAssetIds: [reference],
        options: { sellingPoints: '轻薄透气', price: '¥799.9' },
      }),
      key,
    );
    expect(result).toMatchObject({ state: 'complete', outputs: [{ url: output }] });
    expect(call.mock.calls[0]![0]).toBe(base + 'aiTool/mainImageTagging');
    expect(requestBody()).toEqual({
      sourceUrlList: [signed(source)],
      referenceImageUrl: signed(reference),
      sellingPoints: '轻薄透气',
      price: '¥799.9',
      modelType: 9,
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('reads OCR data.textList as text instead of interpreting pixel quadrilaterals as an edit rectangle (521061419)', async () => {
    const source = randomUUID();
    call.mockResolvedValue({
      code: 200,
      data: {
        imageUrl: signed(source),
        count: 2,
        textList: [
          {
            index: 0,
            text: 'Hello',
            position: [
              [2, 3],
              [22, 3],
              [22, 10],
              [2, 10],
            ],
          },
          {
            index: 1,
            text: 'World',
            position: [
              [2, 12],
              [22, 12],
              [22, 20],
              [2, 20],
            ],
          },
        ],
      },
    });
    expect(
      await flyelepProvider.execute(context({ operation: 'image.ocr', assetIds: [source] }), key),
    ).toMatchObject({
      state: 'complete',
      outputs: [{ text: 'Hello\nWorld', mimeType: 'text/plain' }],
    });
    expect(call.mock.calls[0]![0]).toBe(base + 'aiTool/recognizeImageText');
    expect(requestBody()).toEqual({ imageUrl: signed(source) });
  });
  it('reads synchronous text assistance options with the official language name (521061421)', async () => {
    const source = randomUUID();
    call.mockResolvedValue({
      code: 200,
      data: { options: ['First concrete idea', 'Second concrete idea'] },
    });
    expect(
      await flyelepProvider.execute(
        context({
          operation: 'text.assist',
          assetIds: [source],
          prompt: '写一句视频介绍',
          options: { kind: 'video', platform: 'amazon', language: 'ar' },
        }),
        key,
      ),
    ).toMatchObject({
      state: 'complete',
      outputs: [{ text: 'First concrete idea\n\nSecond concrete idea', mimeType: 'text/plain' }],
    });
    expect(call.mock.calls[0]![0]).toBe(base + 'aiTool/assistedGeneration');
    expect(requestBody()).toEqual({
      query: '写一句视频介绍',
      generateType: 'video',
      platformType: 'amazon',
      languageType: '阿拉伯语',
      fileUrlList: [signed(source)],
    });
  });
  it.each([
    [
      'image-extend',
      'poster/aiTool/intelligentExtension',
      { ratio: '16:9' },
      'imgUrlList',
      { ratio: '16:9' },
    ],
    ['image-upscale', 'poster/aiTool/enlarge', { scale: 4 }, 'imageUrlList', { scalingRatio: 4 }],
    [
      'image-enhance',
      'poster/aiTool/imageClarityEnhance',
      { strength: 'strong' },
      'imageUrlList',
      { enhanceStrength: 'strong' },
    ],
    ['image-cutout', 'poster/aiTool/aiImageMatting', {}, 'imageUrlList', {}],
    ['image-fusion', 'aiTool/longImageFusion', {}, 'imageUrlList', {}],
  ])('sends the official %s tool fields', async (operation, path, options, imageField, extra) => {
    const source = randomUUID(),
      sources = operation === 'image-fusion' ? [source, randomUUID()] : [source];
    expect(
      await flyelepProvider.execute(context({ operation, assetIds: sources, options }), key),
    ).toMatchObject({ state: 'complete', outputs: [{ url: output }] });
    expect(call.mock.calls[0]![0]).toBe(base + path);
    expect(requestBody()).toEqual({
      [imageField as string]: sources.map((id) => signed(id)),
      ...(extra as Record<string, unknown>),
    });
  });
  it.each(['product-replace', 'scene-replace'])(
    'preserves source and replacement roles in %s',
    async (operation) => {
      const source = randomUUID(),
        reference = randomUUID();
      await flyelepProvider.execute(
        context({
          operation,
          assetIds: [source],
          referenceAssetIds: [reference],
          prompt: 'Replace only the intended object',
        }),
        key,
      );
      expect(requestBody()).toEqual({
        sourceUrl: signed(source),
        replaceImageUrl: signed(reference),
        textPrompt: 'Replace only the intended object',
        modelType: 9,
      });
    },
  );
  it('keeps text editing rect in [x,y,width,height] pixels and modelType as a string (521061420)', async () => {
    const source = randomUUID(),
      replacement = { originalText: 'Sale', replaceText: '新品', rect: [47, 60, 557, 109] };
    await flyelepProvider.execute(
      context({
        operation: 'image.text-edit',
        assetIds: [source],
        options: { textReplacements: [replacement] },
      }),
      key,
    );
    expect(call.mock.calls[0]![0]).toBe(base + 'aiTool/textEdit');
    expect(requestBody()).toEqual({
      sourceUrl: signed(source),
      textReplaceList: [{ ...replacement, index: 0 }],
      modelType: '9',
    });
  });
  it('rejects disabled layers before making any potentially billed request', async () => {
    await expect(
      flyelepProvider.execute(
        context({ operation: 'image.layers', assetIds: [randomUUID()] }),
        key,
      ),
    ).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it('expresses the requested product colors in the documented recolor prompt', async () => {
    const source = randomUUID();
    await flyelepProvider.execute(
      context({
        operation: 'product-recolor',
        assetIds: [source],
        prompt: '保留包装文字',
        options: { colors: ['深蓝色'] },
      }),
      key,
    );
    expect(call.mock.calls[0]![0]).toBe(base + 'poster/aiTool/productColorChange');
    expect(requestBody()).toEqual({
      sourceUrl: signed(source),
      textPrompt: '保留包装文字\n将商品改为深蓝色',
      modelType: 9,
    });
  });
  it('does not leak provider secret/body or trust legacy image strings when result is missing', async () => {
    const c = context({ operation: 'image-cutout', assetIds: [randomUUID()] });
    call.mockResolvedValue({ code: 403, msg: `invalid secret ${key}` });
    await expect(flyelepProvider.execute(c, key)).rejects.toMatchObject({ ambiguous: false });
    try {
      await flyelepProvider.execute(c, key);
    } catch (e) {
      expect(String(e)).not.toContain(key);
    }
    call.mockResolvedValue({ code: 200, data: output });
    await expect(flyelepProvider.execute(c, key)).rejects.toMatchObject({ ambiguous: true });
  });
});
describe('white-mask adaptation before external submission', () => {
  it.each([
    { name: 'no alpha', width: 32, height: 32, channels: 3, alpha: 1, message: '透明' },
    { name: 'wrong dimensions', width: 16, height: 32, channels: 4, alpha: 0, message: '尺寸' },
    { name: 'fully opaque', width: 32, height: 32, channels: 4, alpha: 1, message: '透明' },
  ])(
    'rejects $name before calling the provider',
    async ({ width, height, channels, alpha, message }) => {
      const source = randomUUID(),
        mask = randomUUID(),
        sourceBytes = await sharp({
          create: { width: 32, height: 32, channels: 3, background: '#448855' },
        })
          .png()
          .toBuffer(),
        maskBytes = await sharp({
          create: {
            width,
            height,
            channels: channels as 3 | 4,
            background: { r: 255, g: 255, b: 255, alpha },
          },
        })
          .png()
          .toBuffer();
      await expect(
        flyelepProvider.execute(
          context(
            {
              operation: 'image-inpaint',
              assetIds: [source],
              maskAssetId: mask,
              prompt: 'Change only selected area',
            },
            { [source]: sourceBytes, [mask]: maskBytes },
          ),
          key,
        ),
      ).rejects.toThrow(message);
      expect(call).not.toHaveBeenCalled();
    },
  );
  it('uses the signed white mask URL while preserving originals and verifying the representation binding', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'flyelep-mask-'));
    const config: AppConfig = {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(folder, 'test.sqlite'),
      storageDir: join(folder, 'media'),
      sessionSecret: 'fixture-secret',
      encryptionKey: 'fixture-encryption',
      demoMode: true,
      isProduction: false,
      environmentSecrets: { flyelep: key },
    };
    const services = createServices(config);
    try {
      const registered = await services.core.auth.register({
          email: 'mask@example.local',
          password: 'MaskPassword2026!',
          displayName: 'Mask',
        }),
        wid = registered.workspace.id,
        actor = {
          userId: registered.user.id,
          authType: 'session' as const,
          workspaceId: null,
          apiKeyId: null,
          scopes: [],
        };
      config.publicOrigin = 'https://studio.example.com';
      const source = await services.core.assets.ingest(actor, wid, {
        buffer: await sharp({
          create: { width: 32, height: 32, channels: 3, background: '#447766' },
        })
          .png()
          .toBuffer(),
        mimeType: 'image/png',
        name: 'source.png',
      });
      const pixels = Buffer.alloc(32 * 32 * 4);
      for (let y = 0; y < 32; y++) for (let x = 16; x < 32; x++) pixels[(y * 32 + x) * 4 + 3] = 255;
      const maskBytes = await sharp(pixels, { raw: { width: 32, height: 32, channels: 4 } })
        .png()
        .toBuffer();
      const mask = await services.core.assets.ingest(actor, wid, {
        buffer: maskBytes,
        mimeType: 'image/png',
        name: 'mask.png',
      });
      const i = jobInputSchema.parse({
          operation: 'image-inpaint',
          providerId: 'flyelep',
          assetIds: [source.id],
          maskAssetId: mask.id,
          prompt: 'Change only selected area',
        }),
        quote = services.quote(actor, wid, i),
        job = services.submit(actor, wid, i, quote.id, randomUUID());
      services.db.sqlite.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id);
      await flyelepProvider.execute(
        {
          actor,
          workspaceId: wid,
          input: i,
          assetUrl: (id, variant) =>
            services.signedAssetUrl(wid, actor.userId, job.id, id, variant),
          readAsset: (id) => services.core.assets.readOriginal(actor, wid, id),
        },
        key,
      );
      const maskUrl = new URL(String(requestBody().maskDataUrl));
      expect(maskUrl.searchParams.get('variant')).toBe('mask-white');
      const expires = maskUrl.searchParams.get('expires')!,
        signature = maskUrl.searchParams.get('signature')!;
      expect(
        services.verifyMedia(wid, actor.userId, job.id, mask.id, expires, signature, 'mask-white'),
      ).toBe(true);
      expect(
        services.verifyMedia(wid, actor.userId, job.id, mask.id, expires, signature, 'original'),
      ).toBe(false);
      const converted = await services.readProviderMedia(
          wid,
          actor.userId,
          job.id,
          mask.id,
          'mask-white',
        ),
        { data, info } = await sharp(converted.buffer).raw().toBuffer({ resolveWithObject: true });
      expect(data[0]).toBe(255);
      expect(data[24 * info.channels]).toBe(0);
      expect(
        (await services.core.assets.readOriginal(actor, wid, mask.id)).buffer.equals(maskBytes),
      ).toBe(true);
      await expect(
        services.readProviderMedia(wid, actor.userId, job.id, source.id, 'mask-white'),
      ).rejects.toMatchObject({ code: 'ASSET_REFERENCE' });
    } finally {
      closeDatabase(services.db);
      await rm(folder, { recursive: true, force: true });
    }
  });
});
