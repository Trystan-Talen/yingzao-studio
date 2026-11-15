/* eslint-disable @typescript-eslint/no-require-imports */
// Offline BiRefNet-Lite seeds; the parent owns installation and resource limits.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const PROTOCOL = 'yingzao-local-matting-v2';
const SIZE = 1024;
const MAX_PIXELS = 6_000_000;
process.env.ORT_DISABLE_TELEMETRY = '1';
global.fetch = () => {
  throw Error('NETWORK_FORBIDDEN');
};
const output = process.stdout.write.bind(process.stdout);
// Libraries using the JS stdout stream must not corrupt the JSON protocol.
process.stdout.write = process.stderr.write.bind(process.stderr);

function absolutePath(request, field) {
  const value = request[field];
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('PATH_INVALID');
  return value;
}

async function requestFromStdin() {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 32768) throw Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!request || request.protocol !== PROTOCOL) throw Error('PROTOCOL_INVALID');
  return request;
}

async function main() {
  const request = await requestFromStdin();
  const runtimePath = absolutePath(request, 'runtimePath');
  const sharpPath = absolutePath(request, 'sharpPath');
  const runtimePackage = JSON.parse(
    await fs.readFile(path.join(runtimePath, 'package.json'), 'utf8'),
  );
  if (runtimePackage.name !== 'onnxruntime-node' || runtimePackage.version !== '1.31.1')
    throw Error('RUNTIME_VERSION_MISMATCH');
  const ort = require(runtimePath);
  const sharp = require(sharpPath);
  if (ort.env.versions.node !== '1.31.1' || sharp.versions.sharp !== '0.35.5')
    throw Error('RUNTIME_VERSION_MISMATCH');
  if (request.operation === 'health')
    return { protocol: PROTOCOL, stage: 'health', onnxVersion: '1.31.1' };
  if (request.operation !== 'seed') throw Error('OPERATION_INVALID');
  const { width, height } = request;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 64 ||
    height < 64 ||
    width > 4096 ||
    height > 4096 ||
    width * height > MAX_PIXELS
  )
    throw Error('SIZE_INVALID');
  const modelPath = absolutePath(request, 'modelPath');
  const sourcePath = absolutePath(request, 'sourcePath');
  const outputPath = absolutePath(request, 'outputPath');
  if ([sourcePath, modelPath].some((p) => path.resolve(p) === path.resolve(outputPath)))
    throw Error('PATH_COLLISION');
  if ((await fs.stat(sourcePath)).size > 128 * 1024 ** 2) throw Error('INPUT_TOO_LARGE');
  const source = await fs.readFile(sourcePath);
  const decoded = await sharp(source, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== width || decoded.info.height !== height || decoded.info.channels !== 3)
    throw Error('SOURCE_DIMENSIONS_INVALID');
  const rgb =
    width === SIZE && height === SIZE
      ? decoded.data
      : await sharp(decoded.data, { raw: { width, height, channels: 3 } })
          .resize(SIZE, SIZE, { fit: 'fill', kernel: 'linear' })
          .raw()
          .toBuffer();
  const input = new Float32Array(3 * SIZE * SIZE),
    mean = [0.485, 0.456, 0.406],
    std = [0.229, 0.224, 0.225];
  for (let p = 0; p < SIZE * SIZE; p++)
    for (let c = 0; c < 3; c++)
      input[c * SIZE * SIZE + p] = (rgb[p * 3 + c] / 255 - mean[c]) / std[c];
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all',
    enableCpuMemArena: false,
    enableMemPattern: false,
    logSeverityLevel: 3,
  });
  let predictions;
  try {
    if (JSON.stringify(session.inputMetadata[0].shape) !== JSON.stringify([1, 3, SIZE, SIZE]))
      throw Error('MODEL_SHAPE_INVALID');
    predictions = await session.run(
      { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) },
      [session.outputNames.at(-1)],
    );
    const pred = predictions[session.outputNames.at(-1)];
    if (pred.type !== 'float32' || pred.data.length !== SIZE * SIZE)
      throw Error('MODEL_OUTPUT_INVALID');
    const opacity = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < opacity.length; i++) {
      if (!Number.isFinite(pred.data[i])) throw Error('MODEL_OUTPUT_NONFINITE');
      opacity[i] = 1 / (1 + Math.exp(-pred.data[i]));
    }
    let originalOpacity = opacity;
    if (width !== SIZE || height !== SIZE) {
      originalOpacity = new Float32Array(width * height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const sy = Math.max(0, Math.min(SIZE - 1, ((y + 0.5) * SIZE) / height - 0.5)),
            sx = Math.max(0, Math.min(SIZE - 1, ((x + 0.5) * SIZE) / width - 0.5));
          const y0 = Math.floor(sy),
            x0 = Math.floor(sx),
            y1 = Math.min(SIZE - 1, y0 + 1),
            x1 = Math.min(SIZE - 1, x0 + 1),
            dy = sy - y0,
            dx = sx - x0;
          originalOpacity[y * width + x] =
            (opacity[y0 * SIZE + x0] * (1 - dx) + opacity[y0 * SIZE + x1] * dx) * (1 - dy) +
            (opacity[y1 * SIZE + x0] * (1 - dx) + opacity[y1 * SIZE + x1] * dx) * dy;
        }
    }
    let bytes = Buffer.from(originalOpacity.buffer);
    if (os.endianness() !== 'LE') {
      bytes = Buffer.alloc(originalOpacity.length * 4);
      for (let i = 0; i < originalOpacity.length; i++)
        bytes.writeFloatLE(originalOpacity[i], i * 4);
    }
    await fs.writeFile(outputPath, bytes, { flag: 'wx', mode: 0o600 });
    return { protocol: PROTOCOL, stage: 'seed', width, height };
  } finally {
    if (predictions) for (const prediction of Object.values(predictions)) prediction.dispose();
    await session.release();
  }
}

main()
  .then((result) => output(JSON.stringify(result) + '\n'))
  .catch(() => {
    process.stderr.write('LOCAL_MATTING_SEED_FAILED\n');
    process.exitCode = 1;
  });
