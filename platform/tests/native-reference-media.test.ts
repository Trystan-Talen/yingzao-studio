/** Local generated fixtures and actual ffmpeg only; never reads production media. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  extractNativeReferenceClip,
  prepareNativeReferenceMedia,
} from '../src/server/providers/native-reference-media';
const exec = promisify(execFile);
let directory: string;
let video: { buffer: Buffer; mimeType: string };
let subject: { buffer: Buffer; mimeType: string };
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'yingzao-reference-test-'));
  const path = join(directory, 'source.mp4');
  await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=black:s=160x96:r=10',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-vf',
      'geq=lum=16+N*3:cb=128:cr=128',
      '-t',
      '6',
      '-c:v',
      'libx264',
      '-crf',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-threads',
      '2',
      '-y',
      path,
    ],
    { timeout: 60000 },
  );
  video = { buffer: await readFile(path), mimeType: 'video/mp4' };
  subject = {
    buffer: await sharp({ create: { width: 64, height: 48, channels: 3, background: '#008000' } })
      .png()
      .toBuffer(),
    mimeType: 'image/png',
  };
}, 60000);
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('native reference media', () => {
  it('keeps original hashes while making actual oriented, bounded analysis pixels', async () => {
    const buffer = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: '#ff0000' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const result = await prepareNativeReferenceMedia({
      referenceKind: 'image',
      reference: { buffer, mimeType: 'image/jpeg' },
      subject,
    });
    expect(result.referenceSha256).toBe(createHash('sha256').update(buffer).digest('hex'));
    expect(result.frames[0]).toMatchObject({
      index: 0,
      timestampSeconds: 0,
      width: 800,
      height: 1600,
      mimeType: 'image/jpeg',
    });
    expect(result.frames[0]!.sha256).not.toBe(result.referenceSha256);
    expect(result.clipDurationSeconds).toBe(0);
    expect(buffer.equals(result.frames[0]!.buffer)).toBe(false);
  });
  it('samples real distinct frames at measured selected-clip times, preserving their temporal pixel signal', async () => {
    const result = await prepareNativeReferenceMedia({
      referenceKind: 'video',
      reference: video,
      subject,
      trimStartSeconds: 1,
      trimDurationSeconds: 3,
    });
    expect(result).toMatchObject({
      clipStartSeconds: 1,
      clipDurationSeconds: 3,
      sourceDurationSeconds: 6,
    });
    expect(result.frames.map((frame) => frame.sourceTimestampSeconds)).toEqual([
      1, 1.6, 2.2, 2.7, 3.3, 3.9,
    ]);
    for (const frame of result.frames) {
      expect(frame.timestampSeconds).toBeCloseTo(frame.sourceTimestampSeconds - 1, 6);
      const stats = await sharp(frame.buffer).stats();
      const expected = (frame.sourceTimestampSeconds * 10 * 3 * 255) / 219;
      expect(Math.abs(stats.channels[0]!.mean - expected)).toBeLessThan(4);
    }
    expect(new Set(result.frames.map((frame) => frame.sha256)).size).toBe(6);
  }, 60000);
  it('separately encodes the selected MP4 without audio and verifies actual duration', async () => {
    const original = Buffer.from(video.buffer);
    const result = await extractNativeReferenceClip({
      reference: video,
      trimStartSeconds: 2,
      trimDurationSeconds: 2,
    });
    expect(result).toMatchObject({
      width: 160,
      height: 96,
      durationSeconds: 2,
      clipStartSeconds: 2,
      clipDurationSeconds: 2,
      audioIncluded: false,
      mimeType: 'video/mp4',
    });
    expect(video.buffer.equals(original)).toBe(true);
    const path = join(directory, 'clip.mp4');
    await writeFile(path, result.buffer);
    const { stdout } = await exec('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'json',
      path,
    ]);
    expect(JSON.parse(stdout).streams).toEqual([{ codec_type: 'video' }]);
    const sampled = await prepareNativeReferenceMedia({
      referenceKind: 'video',
      reference: { buffer: result.buffer, mimeType: result.mimeType },
      subject,
      sampleCount: 5,
    });
    const stats = await sharp(sampled.frames[0]!.buffer).stats();
    expect(Math.abs(stats.channels[0]!.mean - (60 * 255) / 219)).toBeLessThan(5);
  }, 60000);
  it.each([
    { trimDurationSeconds: 1.9 },
    { trimDurationSeconds: 15.1 },
    { trimStartSeconds: -1 },
    { trimStartSeconds: 5 },
    { trimStartSeconds: 5, trimDurationSeconds: 2 },
    { trimStartSeconds: NaN },
  ])('rejects invalid or out-of-source clip %j', async (trim) => {
    await expect(
      prepareNativeReferenceMedia({ referenceKind: 'video', reference: video, subject, ...trim }),
    ).rejects.toMatchObject({ code: 'NATIVE_REFERENCE_MEDIA_INVALID' });
    await expect(extractNativeReferenceClip({ reference: video, ...trim })).rejects.toMatchObject({
      code: 'NATIVE_REFERENCE_MEDIA_INVALID',
    });
  });
  it('rejects invalid media, unsupported sample counts and inappropriate image clip parameters', async () => {
    for (const sampleCount of [4, 9, 5.5])
      await expect(
        prepareNativeReferenceMedia({
          referenceKind: 'video',
          reference: video,
          subject,
          sampleCount,
        }),
      ).rejects.toThrow();
    await expect(
      prepareNativeReferenceMedia({
        referenceKind: 'image',
        reference: subject,
        subject,
        trimStartSeconds: 0,
      }),
    ).rejects.toThrow();
    await expect(
      prepareNativeReferenceMedia({
        referenceKind: 'image',
        reference: { buffer: Buffer.from('invalid'), mimeType: 'image/png' },
        subject,
      }),
    ).rejects.toThrow(/无法完整解码/);
    await expect(
      prepareNativeReferenceMedia({
        referenceKind: 'video',
        reference: { buffer: Buffer.from('not a video'), mimeType: 'video/mp4' },
        subject,
      }),
    ).rejects.toThrow(/探测失败/);
  });
  it('does not treat an uploaded local-file playlist as a permitted video container', async () => {
    const playlist = {
      mimeType: 'video/mp4',
      buffer: Buffer.from(`ffconcat version 1.0\nfile '${join(directory, 'source.mp4')}'\n`),
    };
    await expect(
      prepareNativeReferenceMedia({ referenceKind: 'video', reference: playlist, subject }),
    ).rejects.toThrow(/探测失败/);
    await expect(extractNativeReferenceClip({ reference: playlist })).rejects.toThrow(/探测失败/);
  });
});
