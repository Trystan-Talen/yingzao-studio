import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { ProviderError } from '../tasks/types';
import { probeLocalMatting, type LocalMattingConfig } from './local-matting-installation';
import {
  assertLocalProcessActive,
  runLocalMattingProcess,
  serialLocalMatting,
  type LocalProcessControl,
} from './local-matting-process';
import {
  LOCAL_MATTING_ALGORITHM,
  LOCAL_MATTING_MAX_PIXELS,
  LOCAL_MATTING_MODEL_SHA256,
  LOCAL_MATTING_PROTOCOL,
} from './local-matting-version';

export { probeLocalMatting, type LocalMattingConfig } from './local-matting-installation';
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
export function validateLocalMattingSize(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 64 ||
    height < 64 ||
    width > 4096 ||
    height > 4096 ||
    width * height > LOCAL_MATTING_MAX_PIXELS
  )
    throw new ProviderError(
      '本机精细抠图支持64至4096像素边长且不超过600万像素的原图；已停止，不会付费生成蒙版。',
      false,
      'LOCAL_MATTING_SIZE_UNSUPPORTED',
    );
}
/** One explicit upright, opaque sRGB PNG feeds the seed, solver and protected pixels. */
export async function canonicalLocalMattingSource(
  buffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  validateLocalMattingSize(width, height);
  const image = sharp(buffer, { limitInputPixels: LOCAL_MATTING_MAX_PIXELS });
  const metadata = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) !== 1)
    throw new ProviderError(
      '本机精细抠图仅支持单张PNG、JPEG或WebP原图。',
      false,
      'LOCAL_MATTING_INPUT_INVALID',
    );
  if (
    metadata.hasAlpha &&
    (await image.clone().extractChannel('alpha').raw().toBuffer()).some((value) => value !== 255)
  )
    throw new ProviderError(
      '当前本机精细抠图要求不透明原图，透明素材不会被静默铺底；尚未调用付费蒙版模型。',
      false,
      'LOCAL_MATTING_INPUT_INVALID',
    );
  const source = await image
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .png()
    .toBuffer({ resolveWithObject: true });
  if (source.info.width !== width || source.info.height !== height)
    throw new ProviderError(
      '原图方向或尺寸与已确认方案不符。',
      false,
      'LOCAL_MATTING_INPUT_INVALID',
    );
  return source.data;
}
export async function runLocalMatting(
  input: LocalProcessControl & {
    source: Buffer;
    rawMask: Buffer;
    color: string;
    width: number;
    height: number;
    sceneBoundary?: 'continuous-soft-exterior-v1';
  },
  config: LocalMattingConfig | undefined,
): Promise<{ mask: Buffer; composite: Buffer; params: Record<string, string | number> }> {
  return serialLocalMatting(async () => {
    assertLocalProcessActive(input);
    validateLocalMattingSize(input.width, input.height);
    if (!/^#[a-f0-9]{6}$/i.test(input.color)) throw new ProviderError('背景颜色无效。');
    const installed = await probeLocalMatting(config, input);
    const workRoot = resolve(config!.workDir);
    await mkdir(workRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(workRoot, 'run-'));
    try {
      const source = await canonicalLocalMattingSource(input.source, input.width, input.height);
      const raw = await sharp(input.rawMask, {
        limitInputPixels: LOCAL_MATTING_MAX_PIXELS,
      }).metadata();
      if (
        raw.width !== input.width ||
        raw.height !== input.height ||
        (raw.orientation && raw.orientation !== 1) ||
        (raw.pages || 1) !== 1
      )
        throw new ProviderError(
          '本机抠图输入尺寸或方向不一致，不会缩放或裁切。',
          false,
          'LOCAL_MATTING_INPUT_INVALID',
        );
      const sourcePath = join(directory, 'source.png'),
        rawMaskPath = join(directory, 'baseline.png'),
        seedPath = join(directory, 'seed.f32'),
        maskOutputPath = join(directory, 'mask.png'),
        compositeOutputPath = join(directory, 'composite.png');
      await writeFile(sourcePath, source, { mode: 0o600 });
      await writeFile(rawMaskPath, input.rawMask, { mode: 0o600 });
      const response = await runLocalMattingProcess({
        ...input,
        pythonPath: installed.pythonPath,
        controllerPath: join(installed.helperDir, 'controller.py'),
        directory,
        timeoutMs: 600_000,
        memoryLimitBytes: 16 * 1024 ** 3,
        request: {
          protocol: LOCAL_MATTING_PROTOCOL,
          lockPath: join(workRoot, 'compute.lock'),
          steps: [
            {
              command: process.execPath,
              args: [join(installed.helperDir, 'seed.cjs')],
              request: {
                protocol: LOCAL_MATTING_PROTOCOL,
                operation: 'seed',
                runtimePath: installed.runtimePath,
                sharpPath: installed.sharpPath,
                modelPath: installed.modelPath,
                sourcePath,
                outputPath: seedPath,
                width: input.width,
                height: input.height,
              },
            },
            {
              command: installed.pythonPath,
              args: ['-I', '-B', join(installed.helperDir, 'matte.py')],
              request: {
                protocol: LOCAL_MATTING_PROTOCOL,
                operation: 'matte',
                sourcePath,
                rawMaskPath,
                seedPath,
                maskOutputPath,
                compositeOutputPath,
                color: input.color,
                width: input.width,
                height: input.height,
                ...(input.sceneBoundary ? { sceneBoundary: input.sceneBoundary } : {}),
              },
            },
          ],
        },
      });
      z.object({
        protocol: z.literal(LOCAL_MATTING_PROTOCOL),
        results: z.tuple([
          z.object({
            protocol: z.literal(LOCAL_MATTING_PROTOCOL),
            stage: z.literal('seed'),
            width: z.literal(input.width),
            height: z.literal(input.height),
          }),
          z.object({
            protocol: z.literal(LOCAL_MATTING_PROTOCOL),
            stage: z.literal('matte'),
            width: z.literal(input.width),
            height: z.literal(input.height),
            algorithm: z.literal(LOCAL_MATTING_ALGORITHM),
            workingColorSpace: z.literal('linear-srgb'),
            sceneBoundary: input.sceneBoundary
              ? z.literal(input.sceneBoundary)
              : z.undefined().optional(),
          }),
        ]),
      }).parse(response);
      if ((await stat(seedPath)).size !== input.width * input.height * 4)
        throw new Error('seed size');
      const seed = await readFile(seedPath);
      for (let i = 0; i < seed.length; i += 4) {
        const value = seed.readFloatLE(i);
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('seed value');
      }
      for (const path of [maskOutputPath, compositeOutputPath])
        if ((await stat(path)).size > 128 * 1024 ** 2) throw new Error('output size');
      const mask = await readFile(maskOutputPath),
        composite = await readFile(compositeOutputPath);
      const a = await sharp(mask, { limitInputPixels: LOCAL_MATTING_MAX_PIXELS })
        .removeAlpha()
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const rgb = await sharp(composite, { limitInputPixels: LOCAL_MATTING_MAX_PIXELS })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (
        a.info.width !== input.width ||
        a.info.height !== input.height ||
        rgb.info.width !== input.width ||
        rgb.info.height !== input.height ||
        !a.data.includes(0) ||
        !a.data.includes(255)
      )
        throw new Error('output dimensions');
      const originalRgb = await sharp(source).removeAlpha().raw().toBuffer();
      const target = [1, 3, 5].map((offset) => parseInt(input.color.slice(offset, offset + 2), 16));
      for (let p = 0; p < a.data.length; p++)
        if (a.data[p] === 0 || a.data[p] === 255)
          for (let channel = 0; channel < 3; channel++)
            if (
              rgb.data[p * 3 + channel] !==
              (a.data[p] === 0 ? originalRgb[p * 3 + channel] : target[channel])
            )
              throw new Error('endpoint pixels');
      assertLocalProcessActive(input);
      return {
        mask,
        composite,
        params: {
          maskAlgorithm: LOCAL_MATTING_ALGORITHM,
          calibrationVersion: 'local-matting-v2',
          workingColorSpace: 'linear-srgb',
          sourceNormalization: 'upright-opaque-srgb-png-v1',
          ...(input.sceneBoundary ? { sceneBoundary: input.sceneBoundary } : {}),
          subjectModelSha256: LOCAL_MATTING_MODEL_SHA256,
          sourceSha256: sha(input.source),
          semanticMaskSha256: sha(input.rawMask),
          maskSha256: sha(mask),
          compositeSha256: sha(composite),
          width: input.width,
          height: input.height,
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        '本机抠图产物未通过完整性校验；已保存模型原件不会重新生成。',
        false,
        'LOCAL_MATTING_OUTPUT_INVALID',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, input);
}
