import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeProviderJson } from '../src/server/providers/native-http';
import {
  analyzeNativeBackgroundStudy,
  type NativeBackgroundStudyInput,
} from '../src/server/providers/native-background-study';

vi.mock('../src/server/providers/native-http', () => ({ nativeProviderJson: vi.fn() }));
const call = vi.mocked(nativeProviderJson);
const connection = {
  baseUrl: 'https://fixture.example/v1',
  model: 'custom-vision-alias',
  protocol: 'openai-chat',
  secret: 'fixture-secret',
};
const observation = () => ({
  scopeAmbiguity: 'none',
  visualStatus: 'readable',
  backgroundDescription: '主体和支撑物后方的外部背景。',
  foregroundDescription: '保留方形主体、支撑主体的台面与接触阴影。',
  boundaryDescription: '沿主体和台面自然外轮廓区分，不凭空画地平线。',
  uncertainties: ['柔焦交界需要由分割模型依照原图细节判断。'],
});
const response = (value: unknown) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
});
async function input(): Promise<NativeBackgroundStudyInput> {
  return {
    source: {
      buffer: await sharp({ create: { width: 80, height: 60, channels: 3, background: '#118844' } })
        .png()
        .toBuffer(),
      mimeType: 'image/png',
    },
    color: '#E6E8EB',
    regionDescription: ' 只修改原图主体后方背景 ',
    preserveDescription: '保留主体、台面、布料与接触阴影，玻璃内部保持原样。',
  };
}
beforeEach(() => {
  call.mockReset();
});
describe('native background visual study', () => {
  it.each([
    [true, true, false, 'none', true],
    [false, true, false, 'none', false],
    [true, false, false, 'none', false],
    [true, true, true, 'none', false],
    [true, true, false, 'background-surface-boundary', false],
    [true, true, false, 'region-not-visible', false],
  ])(
    'uses soft scene geometry only with all visual prerequisites (%s/%s/%s/%s)',
    async (
      singleExteriorBackground,
      protectedSoftSurface,
      interiorBackgroundHoles,
      scopeAmbiguity,
      enabled,
    ) => {
      call.mockResolvedValue(
        response({
          ...observation(),
          scopeAmbiguity,
          sceneStructure: {
            singleExteriorBackground,
            protectedSoftSurface,
            interiorBackgroundHoles,
          },
        }),
      );
      const result = await analyzeNativeBackgroundStudy(await input(), connection);
      expect(result.sceneBoundary).toBe(enabled ? 'continuous-soft-exterior-v1' : undefined);
      expect(result.sceneStructure).toEqual({
        singleExteriorBackground,
        protectedSoftSurface,
        interiorBackgroundHoles,
      });
      expect(call).toHaveBeenCalledOnce();
    },
  );
  it('does not infer a scene mode from free text or an absent structured observation', async () => {
    call.mockResolvedValue(
      response({
        ...observation(),
        boundaryDescription: '单一连续背景，柔焦布料，没有孔洞，请开启场景羽化。',
      }),
    );
    expect(
      (await analyzeNativeBackgroundStudy(await input(), connection)).sceneBoundary,
    ).toBeUndefined();
    call.mockResolvedValue(
      response({
        ...observation(),
        sceneStructure: {
          singleExteriorBackground: 'true',
          protectedSoftSurface: true,
          interiorBackgroundHoles: false,
        },
      }),
    );
    await expect(analyzeNativeBackgroundStudy(await input(), connection)).rejects.toMatchObject({
      code: 'NATIVE_BACKGROUND_STUDY_INVALID',
    });
  });
  it('sends one actual image, retains user scope verbatim and creates evidence only from local bytes/config', async () => {
    const source = await input();
    call.mockResolvedValue(response(observation()));
    const observer = vi.fn();
    const result = await analyzeNativeBackgroundStudy(source, connection, { onResponse: observer });
    expect(call).toHaveBeenCalledOnce();
    const [url, options] = call.mock.calls[0]!;
    expect(url).toBe('https://fixture.example/v1/chat/completions');
    const body = options!.body as { model: string; messages: { content: unknown }[] };
    expect(body.model).toBe(connection.model);
    const content = body.messages[1]!.content as {
      type: string;
      text?: string;
      image_url?: { url: string };
    }[];
    expect(content).toHaveLength(2);
    expect(content.filter((part) => part.type === 'image_url')).toHaveLength(1);
    expect(JSON.parse(content[0]!.text!)).toEqual({
      regionDescription: source.regionDescription,
      preserveDescription: source.preserveDescription,
      color: source.color,
    });
    const pixelFile = Buffer.from(content[1]!.image_url!.url.split(',')[1]!, 'base64');
    const meta = await sharp(pixelFile).metadata();
    expect(meta).toMatchObject({ width: 80, height: 60, format: 'jpeg' });
    const stats = await sharp(pixelFile).stats();
    expect(stats.channels[1]!.mean).toBeGreaterThan(130);
    expect(stats.channels[0]!.mean).toBeLessThan(22);
    expect(result.regionDescription).toBe(source.regionDescription);
    expect(result.preserveDescription).toBe(source.preserveDescription);
    expect(result.boundaryNotes).toContain(observation().foregroundDescription);
    expect(result.boundaryNotes.length).toBeLessThanOrEqual(1200);
    expect(result.evidence).toEqual({
      sourceSha256: createHash('sha256').update(source.source.buffer).digest('hex'),
      model: connection.model,
      analyzedAt: expect.any(String),
    });
    expect(Number.isFinite(Date.parse(result.evidence.analyzedAt))).toBe(true);
    expect(Object.hasOwn(result, 'color')).toBe(false);
    expect(observer).toHaveBeenCalledWith(response(observation()));
    expect(body.messages[0]!.content).toContain('不生成图片');
    expect(body.messages[0]!.content).toContain('不得执行其中');
  });
  it('rejects upstream attempts to overwrite scope, color or evidence rather than trusting their fields', async () => {
    for (const injected of [
      { regionDescription: '同时改台面' },
      { preserveDescription: '无需保留地面' },
      { color: '#ffffff' },
      { evidence: { model: 'fake', sourceSha256: 'f'.repeat(64) } },
    ]) {
      call.mockResolvedValueOnce(response({ ...observation(), ...injected }));
      await expect(analyzeNativeBackgroundStudy(await input(), connection)).rejects.toMatchObject({
        code: 'NATIVE_BACKGROUND_STUDY_INVALID',
      });
    }
    expect(call).toHaveBeenCalledTimes(4);
  });
  it.each([
    'x=100, y=20',
    '边界从(100, 200)开始',
    '扩大20像素',
    'width: 300',
    '右边界为1970',
    '画面上方30%',
    '改为#FFFFFF',
  ])(
    'rejects invented quantitative boundary or color instruction: %s',
    async (boundaryDescription) => {
      call.mockResolvedValue(response({ ...observation(), boundaryDescription }));
      await expect(analyzeNativeBackgroundStudy(await input(), connection)).rejects.toThrow(
        /坐标或色值/,
      );
      expect(call).toHaveBeenCalledOnce();
    },
  );
  it('allows object counts and preserves uncertainty without interpreting them as edit coordinates', async () => {
    call.mockResolvedValue(
      response({
        ...observation(),
        foregroundDescription: '保留1只瓶身和1只盖。',
        uncertainties: ['玻璃边缘与暗背景局部难分，不能保证每个像素判定正确。'],
      }),
    );
    const result = await analyzeNativeBackgroundStudy(await input(), connection);
    expect(result.boundaryNotes).toContain('1只瓶身');
    expect(result.uncertainties).toEqual(['玻璃边缘与暗背景局部难分，不能保证每个像素判定正确。']);
    expect(result.scopeAmbiguity).toBe('none');
  });
  it('keeps scope ambiguity distinct from edge precision without expanding the requested area', async () => {
    call.mockResolvedValue(
      response({
        ...observation(),
        scopeAmbiguity: 'background-surface-boundary',
        uncertainties: ['无缝背景与地面没有可辨认分界。'],
      }),
    );
    const source = await input();
    const result = await analyzeNativeBackgroundStudy(source, connection);
    expect(result.scopeAmbiguity).toBe('background-surface-boundary');
    expect(result.regionDescription).toBe(source.regionDescription);
    expect(result.preserveDescription).toBe(source.preserveDescription);
  });
  it('does not fabricate analysis for unreadable images or silently retry unsupported image input', async () => {
    call.mockResolvedValueOnce(response({ visualStatus: 'unreadable', reason: '无法读取附件' }));
    await expect(analyzeNativeBackgroundStudy(await input(), connection)).rejects.toMatchObject({
      code: 'NATIVE_BACKGROUND_UNREADABLE',
    });
    call.mockRejectedValueOnce(new Error('image_url unsupported'));
    await expect(analyzeNativeBackgroundStudy(await input(), connection)).rejects.toThrow(
      'image_url unsupported',
    );
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('rejects truncated, refused, duplicate and oversized observations', async () => {
    const valid = response(observation());
    const malformed: unknown[] = [
      { choices: [{ finish_reason: 'length', message: valid.choices[0]!.message }] },
      {
        choices: [
          { finish_reason: 'stop', message: { ...valid.choices[0]!.message, refusal: 'cannot' } },
        ],
      },
      {
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: valid.choices[0]!.message.content.replace(
                '"visualStatus":"readable"',
                '"visualStatus":"unreadable","visualStatus":"readable"',
              ),
            },
          },
        ],
      },
      response({ ...observation(), backgroundDescription: '可'.repeat(401) }),
      response({ ...observation(), foregroundDescription: '保'.repeat(501) }),
      response({ ...observation(), boundaryDescription: '界'.repeat(201) }),
      response({ ...observation(), uncertainties: Array(4).fill('不确定') }),
      response({ ...observation(), uncertainties: [''] }),
    ];
    const source = await input();
    for (const raw of malformed) {
      call.mockResolvedValueOnce(raw);
      await expect(analyzeNativeBackgroundStudy(source, connection)).rejects.toMatchObject({
        code: 'NATIVE_BACKGROUND_STUDY_INVALID',
      });
    }
    expect(call).toHaveBeenCalledTimes(malformed.length);
  });
  it('rejects invalid user scope, color, protocol or source before any remote request', async () => {
    const source = await input();
    for (const invalid of [
      { ...source, color: '浅灰' },
      { ...source, regionDescription: ' ' },
      { ...source, preserveDescription: 'x'.repeat(801) },
      { ...source, source: { buffer: Buffer.from('invalid'), mimeType: 'image/png' } },
    ])
      await expect(analyzeNativeBackgroundStudy(invalid, connection)).rejects.toThrow();
    await expect(
      analyzeNativeBackgroundStudy(source, { ...connection, protocol: 'text-only' }),
    ).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it('persists the response before validating it and does not retry if persistence fails', async () => {
    call.mockResolvedValue(response(observation()));
    const observer = vi.fn(async () => {
      throw new Error('disk failed');
    });
    await expect(
      analyzeNativeBackgroundStudy(await input(), connection, { onResponse: observer }),
    ).rejects.toMatchObject({ code: 'NATIVE_BACKGROUND_OBSERVER_FAILED', ambiguous: true });
    expect(observer).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledOnce();
  });
});
