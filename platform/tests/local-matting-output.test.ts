import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runLocalMatting } from '../src/server/providers/local-matting';
import { runLocalMattingProcess } from '../src/server/providers/local-matting-process';
import {
  LOCAL_MATTING_PROTOCOL,
  LOCAL_MATTING_ALGORITHM,
} from '../src/server/providers/local-matting-version';

vi.mock('../src/server/providers/local-matting-installation', () => ({
  probeLocalMatting: vi.fn(async () => ({
    pythonPath: '/offline/venv/bin/python',
    runtimePath: '/offline/runtime',
    modelPath: '/offline/model',
    helperDir: '/offline/helper',
    sharpPath: '/offline/sharp',
  })),
}));
vi.mock('../src/server/providers/local-matting-process', async (original) => ({
  ...(await original<typeof import('../src/server/providers/local-matting-process')>()),
  runLocalMattingProcess: vi.fn(),
}));
const execute = vi.mocked(runLocalMattingProcess),
  directories: string[] = [];
let wrongScene = false,
  invalidSeed = false,
  wrongEndpoint = false,
  rawSeen: Buffer;
beforeEach(() => {
  wrongScene = false;
  invalidSeed = false;
  wrongEndpoint = false;
  execute.mockReset().mockImplementation(async (options) => {
    const request = options.request as { steps: { request: Record<string, string | number> }[] };
    const seed = request.steps[0]!.request,
      matte = request.steps[1]!.request;
    rawSeen = await readFile(String(matte.rawMaskPath));
    const float = Buffer.alloc(64 * 64 * 4);
    for (let i = 0; i < float.length; i += 4) float.writeFloatLE(invalidSeed ? NaN : 0.5, i);
    await writeFile(String(seed.outputPath), float);
    const mask = Buffer.from(Array.from({ length: 64 * 64 }, (_, i) => (i % 64 < 32 ? 0 : 255)));
    const source = await sharp(String(matte.sourcePath)).removeAlpha().raw().toBuffer();
    const composite = Buffer.from(source);
    for (let i = 0; i < mask.length; i++)
      if (mask[i] === 255) composite.set([170, 187, 204], i * 3);
    if (wrongEndpoint) composite[0] = 255;
    await writeFile(
      String(matte.maskOutputPath),
      await sharp(mask, { raw: { width: 64, height: 64, channels: 1 } })
        .png()
        .toBuffer(),
    );
    await writeFile(
      String(matte.compositeOutputPath),
      await sharp(composite, { raw: { width: 64, height: 64, channels: 3 } })
        .png()
        .toBuffer(),
    );
    return {
      protocol: LOCAL_MATTING_PROTOCOL,
      results: [
        { protocol: LOCAL_MATTING_PROTOCOL, stage: 'seed', width: 64, height: 64 },
        {
          protocol: LOCAL_MATTING_PROTOCOL,
          stage: 'matte',
          width: 64,
          height: 64,
          algorithm: LOCAL_MATTING_ALGORITHM,
          workingColorSpace: 'linear-srgb',
          ...(matte.sceneBoundary
            ? { sceneBoundary: wrongScene ? 'untrusted-other-mode' : matte.sceneBoundary }
            : {}),
        },
      ],
    };
  });
});
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'yingzao-matting-output-'));
  directories.push(directory);
  const source = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  // The raw paid file is passed unchanged; the Python helper alone owns Pillow grayscale conversion.
  const rawMask = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  return {
    input: { source, rawMask, color: '#aabbcc', width: 64, height: 64 },
    config: { installationDir: directory, workDir: directory },
    directory,
  };
}
it.each([undefined, 'continuous-soft-exterior-v1'] as const)(
  'accepts the actual helper response contract for %s and validates saved pixels',
  async (sceneBoundary) => {
    const f = await fixture();
    const result = await runLocalMatting({ ...f.input, sceneBoundary }, f.config);
    expect(result.params.sceneBoundary).toBe(sceneBoundary);
    expect(rawSeen).toEqual(f.input.rawMask);
    const rgb = await sharp(result.composite).raw().toBuffer();
    expect([...rgb.subarray(0, 3)]).toEqual([18, 52, 86]);
    expect([...rgb.subarray(63 * 3, 64 * 3)]).toEqual([170, 187, 204]);
    expect(await readdir(f.directory)).toEqual([]);
  },
);
it.each(['scene', 'seed', 'protected-pixel'] as const)(
  'rejects invalid %s without returning a candidate and removes ephemeral floats',
  async (kind) => {
    const f = await fixture();
    wrongScene = kind === 'scene';
    invalidSeed = kind === 'seed';
    wrongEndpoint = kind === 'protected-pixel';
    await expect(
      runLocalMatting({ ...f.input, sceneBoundary: 'continuous-soft-exterior-v1' }, f.config),
    ).rejects.toMatchObject({ code: 'LOCAL_MATTING_OUTPUT_INVALID' });
    expect(await readdir(f.directory)).toEqual([]);
  },
);
