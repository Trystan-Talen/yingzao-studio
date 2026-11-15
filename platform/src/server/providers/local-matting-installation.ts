import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { constants } from 'node:fs';
import { z } from 'zod';
import { ProviderError } from '../tasks/types';
import { runLocalMattingProcess, type LocalProcessControl } from './local-matting-process';
import {
  LOCAL_MATTING_HELPER_SHA256,
  LOCAL_MATTING_MODEL_BYTES,
  LOCAL_MATTING_MODEL_SHA256,
  LOCAL_MATTING_PROTOCOL,
  LOCAL_MATTING_PYTHON_VERSIONS,
} from './local-matting-version';

export interface LocalMattingConfig {
  installationDir: string;
  workDir: string;
  helperDir?: string;
}
export interface LocalMattingInstallation {
  pythonPath: string;
  runtimePath: string;
  modelPath: string;
  helperDir: string;
  sharpPath: string;
  identity: string;
}
const installedSchema = z
  .object({
    version: z.literal(1),
    pythonPath: z.string().min(1),
    runtimePath: z.string().min(1),
    modelPath: z.string().min(1),
  })
  .strict();
export async function localFileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
function unavailable(): ProviderError {
  return new ProviderError(
    '本机精细抠图尚未安装或版本校验未通过；已停止，不会调用付费蒙版模型。',
    false,
    'LOCAL_MATTING_UNAVAILABLE',
  );
}
export function localMattingHelperDirectory(config: LocalMattingConfig): string {
  if (config.helperDir) return resolve(config.helperDir);
  const deployed = resolve('dist/runtime/local-matting');
  return process.env.NODE_ENV === 'production' || !existsSync(resolve('scripts/local-matting'))
    ? deployed
    : resolve('scripts/local-matting');
}
const checks = new Map<string, { until: number; result: Promise<void> }>();

/** No neural inference. All binaries are installed offline and verified before paid work. */
export async function probeLocalMatting(
  config: LocalMattingConfig | undefined,
  control: LocalProcessControl = {},
): Promise<LocalMattingInstallation> {
  if (!config || process.platform !== 'darwin') throw unavailable();
  try {
    const manifestPath = join(resolve(config.installationDir), 'installation.json');
    const manifest = installedSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    if (![manifest.pythonPath, manifest.runtimePath, manifest.modelPath].every(isAbsolute))
      throw unavailable();
    // Preserve the venv entry path: executing its realpath loses pyvenv.cfg/site-packages.
    const pythonExecutable = await realpath(manifest.pythonPath);
    const pythonPath = resolve(manifest.pythonPath);
    const runtimePath = await realpath(manifest.runtimePath);
    const modelPath = await realpath(manifest.modelPath);
    await access(pythonPath, constants.X_OK);
    await access('/usr/bin/sandbox-exec', constants.X_OK);
    const model = await stat(modelPath);
    if (
      !model.isFile() ||
      model.size !== LOCAL_MATTING_MODEL_BYTES ||
      (await localFileSha256(modelPath)) !== LOCAL_MATTING_MODEL_SHA256
    )
      throw unavailable();
    const helperDir = localMattingHelperDirectory(config);
    for (const [name, expected] of Object.entries(LOCAL_MATTING_HELPER_SHA256))
      if (!expected || (await localFileSha256(join(helperDir, name))) !== expected)
        throw unavailable();
    const packageFile = join(runtimePath, 'package.json');
    const runtimePackage = JSON.parse(await readFile(packageFile, 'utf8')) as {
      name?: string;
      version?: string;
    };
    if (runtimePackage.name !== 'onnxruntime-node' || runtimePackage.version !== '1.31.1')
      throw unavailable();
    const pythonStat = await stat(pythonExecutable),
      runtimeStat = await stat(packageFile);
    const identity = createHash('sha256')
      .update(
        JSON.stringify({
          pythonPath,
          runtimePath,
          modelPath,
          helperDir,
          pythonMtime: pythonStat.mtimeMs,
          runtimeMtime: runtimeStat.mtimeMs,
          modelSha: LOCAL_MATTING_MODEL_SHA256,
          helpers: LOCAL_MATTING_HELPER_SHA256,
        }),
      )
      .digest('hex');
    const sharpPath = createRequire(import.meta.url).resolve('sharp');
    const installed = { pythonPath, runtimePath, modelPath, helperDir, sharpPath, identity };
    let cached = checks.get(identity);
    if (!cached || cached.until < Date.now()) {
      const result = (async () => {
        await mkdir(resolve(config.workDir), { recursive: true, mode: 0o700 });
        const directory = await mkdtemp(join(resolve(config.workDir), 'health-'));
        try {
          const response = await runLocalMattingProcess({
            pythonPath,
            controllerPath: join(helperDir, 'controller.py'),
            directory,
            timeoutMs: 30_000,
            memoryLimitBytes: 2 * 1024 ** 3,
            ...control,
            request: {
              protocol: LOCAL_MATTING_PROTOCOL,
              steps: [
                {
                  command: process.execPath,
                  args: [join(helperDir, 'seed.cjs')],
                  request: {
                    protocol: LOCAL_MATTING_PROTOCOL,
                    operation: 'health',
                    runtimePath,
                    sharpPath,
                  },
                },
                {
                  command: pythonPath,
                  args: ['-I', '-B', join(helperDir, 'matte.py')],
                  request: { protocol: LOCAL_MATTING_PROTOCOL, operation: 'health' },
                },
              ],
            },
          });
          const parsed = z
            .object({
              protocol: z.literal(LOCAL_MATTING_PROTOCOL),
              results: z.tuple([
                z.object({
                  protocol: z.literal(LOCAL_MATTING_PROTOCOL),
                  stage: z.literal('health'),
                  onnxVersion: z.literal('1.31.1'),
                }),
                z.object({
                  protocol: z.literal(LOCAL_MATTING_PROTOCOL),
                  stage: z.literal('health'),
                  versions: z.record(z.string(), z.string()),
                }),
              ]),
            })
            .parse(response);
          for (const [name, expected] of Object.entries(LOCAL_MATTING_PYTHON_VERSIONS))
            if (parsed.results[1].versions[name] !== expected) throw unavailable();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      })();
      cached = { until: Date.now() + 30_000, result };
      checks.set(identity, cached);
      void result.catch(() => {
        if (checks.get(identity)?.result === result) checks.delete(identity);
      });
    }
    await cached.result;
    return installed;
  } catch (error) {
    if (
      error instanceof ProviderError &&
      ['LOCAL_MATTING_CANCELLED', 'LOCAL_MATTING_LEASE_LOST'].includes(error.code)
    )
      throw error;
    throw unavailable();
  }
}
