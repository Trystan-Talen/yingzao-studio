import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { probeLocalMatting } from '../src/server/providers/local-matting-installation';
import { runLocalMattingProcess } from '../src/server/providers/local-matting-process';
import {
  LOCAL_MATTING_PROTOCOL,
  LOCAL_MATTING_PYTHON_VERSIONS,
} from '../src/server/providers/local-matting-version';

// No model is loaded. Small local files exercise the same pinned-byte and dependency checks.
vi.mock('../src/server/providers/local-matting-version', async (original) => {
  const actual = await original<typeof import('../src/server/providers/local-matting-version')>();
  const crypto = await import('node:crypto');
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
  return {
    ...actual,
    LOCAL_MATTING_MODEL_BYTES: 5,
    LOCAL_MATTING_MODEL_SHA256: digest('model'),
    LOCAL_MATTING_HELPER_SHA256: {
      'controller.py': digest('controller'),
      'seed.cjs': digest('seed'),
      'matte.py': digest('matte'),
    },
  };
});
vi.mock('../src/server/providers/local-matting-process', () => ({
  runLocalMattingProcess: vi.fn(),
}));
const health = vi.mocked(runLocalMattingProcess),
  directories: string[] = [];
const response = () => ({
  protocol: LOCAL_MATTING_PROTOCOL,
  results: [
    { protocol: LOCAL_MATTING_PROTOCOL, stage: 'health', onnxVersion: '1.31.1' },
    {
      protocol: LOCAL_MATTING_PROTOCOL,
      stage: 'health',
      versions: { ...LOCAL_MATTING_PYTHON_VERSIONS },
    },
  ],
});
beforeEach(() => health.mockReset().mockResolvedValue(response()));
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function installation() {
  const root = await mkdtemp(join(tmpdir(), 'yingzao-matting-install-'));
  directories.push(root);
  const paths = {
    pythonPath: join(root, 'venv/bin/python'),
    runtimePath: join(root, 'runtime'),
    modelPath: join(root, 'model.onnx'),
  };
  const helperDir = join(root, 'helpers');
  await Promise.all([
    mkdir(join(root, 'venv/bin'), { recursive: true }),
    mkdir(paths.runtimePath),
    mkdir(helperDir),
  ]);
  await symlink(process.execPath, paths.pythonPath);
  await writeFile(paths.modelPath, 'model');
  await writeFile(
    join(paths.runtimePath, 'package.json'),
    JSON.stringify({ name: 'onnxruntime-node', version: '1.31.1' }),
  );
  for (const [file, contents] of [
    ['controller.py', 'controller'],
    ['seed.cjs', 'seed'],
    ['matte.py', 'matte'],
  ])
    await writeFile(join(helperDir, file!), contents!);
  await writeFile(join(root, 'installation.json'), JSON.stringify({ version: 1, ...paths }));
  return { config: { installationDir: root, workDir: join(root, 'work'), helperDir }, ...paths };
}
it('retains the venv invocation path in controller and Python child health checks', async () => {
  const f = await installation();
  const installed = await probeLocalMatting(f.config);
  expect(installed.pythonPath).toBe(f.pythonPath);
  expect(health).toHaveBeenCalledTimes(1);
  expect(health).toHaveBeenCalledWith(
    expect.objectContaining({
      pythonPath: f.pythonPath,
      request: expect.objectContaining({
        steps: expect.arrayContaining([
          expect.objectContaining({
            command: f.pythonPath,
            args: ['-I', '-B', join(f.config.helperDir, 'matte.py')],
          }),
        ]),
      }),
    }),
  );
});
it.each(['model', 'helper', 'runtime', 'python-dependency'] as const)(
  'rejects mismatched %s instead of silently downgrading before paid work',
  async (kind) => {
    const f = await installation();
    if (kind === 'model') await writeFile(f.modelPath, 'other');
    if (kind === 'helper') await writeFile(join(f.config.helperDir, 'matte.py'), 'modified');
    if (kind === 'runtime')
      await writeFile(
        join(f.runtimePath, 'package.json'),
        JSON.stringify({ name: 'onnxruntime-node', version: '0.0.0' }),
      );
    if (kind === 'python-dependency') {
      const value = response();
      value.results[1]!.versions!.pymatting = '0.0.0';
      health.mockResolvedValue(value);
    }
    await expect(probeLocalMatting(f.config)).rejects.toMatchObject({
      code: 'LOCAL_MATTING_UNAVAILABLE',
      ambiguous: false,
    });
    expect(health).toHaveBeenCalledTimes(kind === 'python-dependency' ? 1 : 0);
  },
);
