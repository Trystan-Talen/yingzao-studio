import { beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { jobInputSchema } from '../src/contracts/jobs';
import { openaiProvider } from '../src/server/providers/openai';
import { providerJson } from '../src/server/providers/http';
import type { ExecutionContext } from '../src/server/tasks/types';
import type { DesignPlan } from '../src/contracts/design-plan';
vi.mock('../src/server/providers/http', () => ({ providerJson: vi.fn() }));
const call = vi.mocked(providerJson);
beforeEach(() => {
  vi.clearAllMocks();
  call.mockResolvedValue({
    data: [{ b64_json: Buffer.from('contract-test-only-image').toString('base64') }],
  });
});
function context(input: unknown, files: Record<string, Buffer> = {}): ExecutionContext {
  return {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: jobInputSchema.parse(input),
    readAsset: async (id) => {
      if (!files[id]) throw new Error('missing fixture');
      return { buffer: files[id]!, mimeType: 'image/png', name: 'fixture.png' };
    },
  };
}
it('preserves specific white-background intent and frozen product facts in image requests', async () => {
  await openaiProvider.execute(
    context({
      operation: 'image.generate',
      providerId: 'openai',
      prompt: '玻璃瓶',
      referenceText: '净含量30ml',
      options: { kind: 'white-background', needText: false },
    }),
    'test-contract-key',
  );
  const request = call.mock.calls[0]![1]!.body as { prompt: string; model: string };
  expect(request.prompt).toContain('pure white (#FFFFFF)');
  expect(request.prompt).toContain('净含量30ml');
  expect(request.prompt).toContain('No text or lettering');
});
it.each([
  { name: 'opaque', width: 32, height: 32, alpha: 1, message: '没有透明' },
  { name: 'wrong size', width: 16, height: 32, alpha: 0, message: '尺寸必须' },
])(
  'rejects $name masks before making any billed request',
  async ({ width, height, alpha, message }) => {
    const sourceId = randomUUID(),
      maskId = randomUUID();
    const source = await sharp({
      create: { width: 32, height: 32, channels: 4, background: '#fff' },
    })
      .png()
      .toBuffer();
    const mask = await sharp({
      create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha } },
    })
      .png()
      .toBuffer();
    await expect(
      openaiProvider.execute(
        context(
          {
            operation: 'image-inpaint',
            providerId: 'openai',
            assetIds: [sourceId],
            maskAssetId: maskId,
          },
          { [sourceId]: source, [maskId]: mask },
        ),
        'test-contract-key',
      ),
    ).rejects.toThrow(message);
    expect(call).not.toHaveBeenCalled();
  },
);
it('sends the actual full-resolution mask and retains both primary and reference images', async () => {
  const a = randomUUID(),
    b = randomUUID(),
    m = randomUUID(),
    source = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#fff' } })
      .png()
      .toBuffer(),
    mask = await sharp({
      create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
  await openaiProvider.execute(
    context(
      {
        operation: 'image-inpaint',
        providerId: 'openai',
        assetIds: [a],
        referenceAssetIds: [b],
        maskAssetId: m,
      },
      { [a]: source, [b]: source, [m]: mask },
    ),
    'test-contract-key',
  );
  const body = call.mock.calls[0]![1]!.body as { images: unknown[]; mask: { image_url: string } };
  expect(body.images).toHaveLength(2);
  expect(body.mask.image_url).toBe(`data:image/png;base64,${mask.toString('base64')}`);
});
it('includes all unique image references and real extracted document context in text assistance', async () => {
  const a = randomUUID(),
    b = randomUUID();
  call.mockResolvedValue({
    output: [{ type: 'message', content: [{ type: 'output_text', text: '合同测试建议' }] }],
  });
  const result = await openaiProvider.execute(
    context(
      {
        operation: 'text.assist',
        providerId: 'openai',
        prompt: '为产品写建议',
        assetIds: [a],
        referenceAssetIds: [b, a],
        referenceText: '成分：植物萃取',
      },
      {
        [a]: await sharp({ create: { width: 32, height: 24, channels: 3, background: '#fff' } })
          .png()
          .toBuffer(),
        [b]: await sharp({ create: { width: 24, height: 32, channels: 3, background: '#111' } })
          .png()
          .toBuffer(),
      },
    ),
    'test-contract-key',
  );
  const body = call.mock.calls[0]![1]!.body as {
    input: { content: { type: string; text?: string }[] }[];
  };
  expect(body.input[0]!.content.filter((c) => c.type === 'input_image')).toHaveLength(2);
  expect(JSON.stringify(body)).toContain('成分：植物萃取');
  expect(result.state).toBe('complete');
});
it('validates structured design plans and preserves all required design sections', async () => {
  const plan: DesignPlan = {
    analysis: '参考图是一个玻璃瓶',
    objective: '突出30ml规格',
    style: '自然摄影',
    palette: ['绿色', '米色'],
    composition: '左侧产品右侧文字',
    copy: ['产品事实'],
    scene: '石台窗光',
    technical: { ratio: '3:4', resolution: '1K', language: 'zh-CN' },
    directions: [1, 2, 3].map((i) => ({ title: `方向${i}`, prompt: '保留真实产品细节' })),
  };
  call.mockResolvedValue({
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(plan) }] }],
  });
  const result = await openaiProvider.execute(
    context({
      operation: 'text.assist',
      providerId: 'openai',
      prompt: '详情方案',
      conversationContext: '用户：不添加虚构功效',
      options: { assistantMode: 'design-plan' },
    }),
    'test-contract-key',
  );
  expect(call.mock.calls[0]![1]!.body).toMatchObject({
    text: { format: { type: 'json_schema', strict: true, name: 'design_plan' } },
  });
  if (result.state !== 'complete') throw new Error('Expected text result');
  expect(result.outputs[0]!.text).toContain('构图与版式：左侧产品右侧文字');
  expect(result.outputs[0]!.text).toContain('3. 方向3');
  expect(result.outputs[0]!.resultData).toEqual({ type: 'design-plan', version: 1, plan });
  call.mockResolvedValue({
    output: [
      { type: 'message', content: [{ type: 'output_text', text: '{"style":"incomplete"}' }] },
    ],
  });
  await expect(
    openaiProvider.execute(
      context({
        operation: 'text.assist',
        providerId: 'openai',
        prompt: '详情方案',
        options: { assistantMode: 'design-plan' },
      }),
      'test-contract-key',
    ),
  ).rejects.toMatchObject({ ambiguous: true });
});

it('retains OCR regions in original-pixel coordinates and rejects out-of-bounds model output', async () => {
  const a = randomUUID(),
    image = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
  const fixture = (rect: number[]) => ({
    output: [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: JSON.stringify({ regions: [{ text: '30 ml', rect }] }) },
        ],
      },
    ],
  });
  call.mockResolvedValue(fixture([5, 10, 40, 20]));
  const result = await openaiProvider.execute(
    context({ operation: 'image.ocr', providerId: 'openai', assetIds: [a] }, { [a]: image }),
    'test-contract-key',
  );
  if (result.state !== 'complete') throw new Error('Expected OCR result');
  expect(JSON.parse(result.outputs[0]!.text!)).toMatchObject({
    imageAssetId: a,
    imageWidth: 100,
    imageHeight: 80,
    regions: [{ text: '30 ml', rect: [5, 10, 40, 20] }],
    coordinateSource: 'model-estimate',
  });
  const request = JSON.stringify(call.mock.calls[0]![1]!.body);
  expect(request).not.toContain('prefixItems');
  call.mockResolvedValue(fixture([80, 10, 40, 20]));
  await expect(
    openaiProvider.execute(
      context({ operation: 'image.ocr', providerId: 'openai', assetIds: [a] }, { [a]: image }),
      'test-contract-key',
    ),
  ).rejects.toMatchObject({ ambiguous: true });
});

it('uses the same upright EXIF pixels for OCR, image editing and transparent masks', async () => {
  const sourceId = randomUUID(),
    maskId = randomUUID();
  const source = await sharp({
    create: { width: 80, height: 100, channels: 3, background: '#fff' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  call.mockResolvedValueOnce({
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({ regions: [{ text: 'Label', rect: [90, 5, 10, 20] }] }),
          },
        ],
      },
    ],
  });
  const result = await openaiProvider.execute(
    context(
      { operation: 'image.ocr', providerId: 'openai', assetIds: [sourceId] },
      { [sourceId]: source },
    ),
    'test-contract-key',
  );
  if (result.state !== 'complete') throw new Error('Expected OCR result');
  expect(JSON.parse(result.outputs[0]!.text!)).toMatchObject({
    imageWidth: 100,
    imageHeight: 80,
    regions: [{ text: 'Label', rect: [90, 5, 10, 20] }],
  });
  const ocrBody = call.mock.calls[0]![1]!.body as {
    input: { content: { type: string; image_url?: string }[] }[];
  };
  const url = ocrBody.input[0]!.content.find((x) => x.type === 'input_image')!.image_url!;
  const decoded = Buffer.from(url.split(',')[1]!, 'base64');
  expect(await sharp(decoded).metadata()).toMatchObject({ width: 100, height: 80, format: 'png' });
  expect((await sharp(decoded).metadata()).orientation).toBeUndefined();
  const mask = await sharp({
    create: { width: 100, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  call.mockResolvedValueOnce({
    data: [{ b64_json: Buffer.from('contract-test-only-image').toString('base64') }],
  });
  await openaiProvider.execute(
    context(
      {
        operation: 'image-inpaint',
        providerId: 'openai',
        assetIds: [sourceId],
        maskAssetId: maskId,
      },
      { [sourceId]: source, [maskId]: mask },
    ),
    'test-contract-key',
  );
  const editBody = call.mock.calls[1]![1]!.body as {
    images: { image_url: string }[];
    mask: { image_url: string };
  };
  expect(editBody.images[0]!.image_url).toBe(url);
  expect(editBody.mask.image_url).toBe(`data:image/png;base64,${mask.toString('base64')}`);
});

it('does not call the image model or charge platform translation credits when text detection is empty', async () => {
  const id = randomUUID();
  const original = await sharp({
    create: { width: 32, height: 40, channels: 3, background: '#54a187' },
  })
    .png()
    .toBuffer();
  call.mockResolvedValueOnce({
    output: [{ type: 'message', content: [{ type: 'output_text', text: '{"hasText":false}' }] }],
  });
  const result = await openaiProvider.execute(
    context(
      {
        operation: 'image-translate',
        providerId: 'openai',
        assetIds: [id],
        options: { languages: ['en'], language: 'en' },
      },
      { [id]: original },
    ),
    'test-key',
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]![0]).toBe('https://api.openai.com/v1/responses');
  expect(result).toMatchObject({ state: 'complete', billingDisposition: 'no-visible-text' });
  if (result.state !== 'complete') throw new Error('wrong result');
  expect(result.outputs[0]!.buffer).toEqual(original);
  expect(result.outputs[0]!.text).toContain('未扣平台翻译额度');
});
it('translates text-present images and rejects invalid detection instead of treating it as free', async () => {
  const id = randomUUID();
  const original = await sharp({
    create: { width: 32, height: 40, channels: 3, background: '#54a187' },
  })
    .png()
    .toBuffer();
  const ctx = context(
    {
      operation: 'image-translate',
      providerId: 'openai',
      assetIds: [id],
      options: { languages: ['fr'], language: 'fr' },
    },
    { [id]: original },
  );
  call.mockResolvedValueOnce({
    output: [{ type: 'message', content: [{ type: 'output_text', text: '{"hasText":true}' }] }],
  });
  const translated = await openaiProvider.execute(ctx, 'test-key');
  expect(translated).toMatchObject({ state: 'complete' });
  expect(translated).not.toHaveProperty('billingDisposition');
  expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls[1]![0]).toContain('/images/edits');
  call.mockClear();
  call.mockResolvedValueOnce({
    output: [{ type: 'message', content: [{ type: 'output_text', text: '{"hasText":"false"}' }] }],
  });
  await expect(openaiProvider.execute(ctx, 'test-key')).rejects.toMatchObject({ ambiguous: true });
  expect(call).toHaveBeenCalledTimes(1);
});

it('lets the user explicitly force translation when the text detector missed content', async () => {
  const id = randomUUID();
  const original = await sharp({
    create: { width: 32, height: 40, channels: 3, background: '#54a187' },
  })
    .png()
    .toBuffer();
  const result = await openaiProvider.execute(
    context(
      {
        operation: 'image-translate',
        providerId: 'openai',
        assetIds: [id],
        options: { languages: ['en'], language: 'en', forceTranslation: true },
      },
      { [id]: original },
    ),
    'test-key',
  );
  expect(result).toMatchObject({ state: 'complete' });
  expect(result).not.toHaveProperty('billingDisposition');
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]![0]).toContain('/images/edits');
});
