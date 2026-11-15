import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isolatedTestEnvironment } from '../scripts/test-environment';

const temporary: string[] = [];
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'yingzao-test-environment-'));
  temporary.push(root);
  return root;
}
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('test subprocess isolation', () => {
  it('lets direct Vitest workers encode and probe a real video without a caller-supplied media PATH', () => {
    const video = join(directory(), 'tool-path.mp4');
    // Inherit this worker's environment: this exercises vitest.config.ts, not a helper override.
    const encoded = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=32x32:r=1',
        '-t',
        '1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        video,
      ],
      { encoding: 'utf8' },
    );
    expect(encoded.status, encoded.error?.message || encoded.stderr).toBe(0);
    const probed = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', video],
      { encoding: 'utf8' },
    );
    expect(probed.status, probed.error?.message || probed.stderr).toBe(0);
    const actual = JSON.parse(probed.stdout) as {
      streams: { width: number; height: number }[];
      format: { duration: string };
    };
    expect(actual.streams[0]).toMatchObject({ width: 32, height: 32 });
    expect(Number(actual.format.duration)).toBeCloseTo(1, 2);
  });

  it('loads the real config in a child without inherited provider credentials or local dotenv settings', () => {
    const root = directory();
    writeFileSync(
      join(root, '.env'),
      [
        'DIFY_API_KEY=synthetic-local-dify',
        'SEEDANCE_API_KEY=synthetic-local-seedance',
        'SMTP_ENABLED=true',
        'MEDIA_DNS_MODE=invalid-user-config',
      ].join('\n'),
    );
    const env = isolatedTestEnvironment(resolve('.'), {
      PATH: '/usr/bin:/bin',
      DIFY_API_KEY: 'synthetic-inherited-dify',
      SEEDANCE_API_KEY: 'synthetic-inherited-seedance',
      OPENAI_API_KEY: 'synthetic-inherited-openai',
      SESSION_SECRET: 'synthetic-old-session',
      ENCRYPTION_KEY: 'synthetic-old-encryption',
      STRIPE_SECRET_KEY: 'synthetic-inherited-billing',
      SMTP_ENABLED: 'true',
      NODE_OPTIONS: '--require=/synthetic/nonexistent-module',
      VITE_PRIVATE_DATA: 'synthetic-build-secret',
      DOTENV_CONFIG_PATH: join(root, '.env'),
    });
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.VITE_PRIVATE_DATA).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
    const database = join(root, 'test.sqlite');
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        resolve('node_modules/tsx/dist/loader.mjs'),
        '--input-type=module',
        '-e',
        `import {loadConfig} from ${JSON.stringify(resolve('src/server/config.ts'))};
       const c=loadConfig();
       console.log(JSON.stringify({providers:Object.values(c.environmentSecrets).filter(Boolean).length,
         billing:Boolean(c.billing?.stripeSecretKey),smtp:c.smtp?.enabled,
         mediaDns:c.mediaDnsMode,database:c.databasePath===${JSON.stringify(database)}}));`,
      ],
      {
        cwd: root,
        env: {
          ...env,
          NODE_ENV: 'production',
          DEMO_MODE: 'false',
          SESSION_SECRET: 'synthetic-new-session-1234567890123456',
          ENCRYPTION_KEY: 'synthetic-new-encryption-6543210987654321',
          DATABASE_PATH: database,
          STORAGE_DIR: join(root, 'media'),
        },
        encoding: 'utf8',
      },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      providers: 0,
      billing: false,
      smtp: false,
      mediaDns: 'system',
      database: true,
    });
    expect(readFileSync(join(root, '.env'), 'utf8')).toContain('synthetic-local-dify');
  });

  it('finds bundled media commands with an otherwise minimal PATH and prefers the current installation', () => {
    const root = directory();
    for (const [layout, marker] of [
      ['native-media', 'current-fixture'],
      ['ffmpeg-9.0.2-macos-arm64', 'legacy-fixture'],
    ]) {
      const bin = join(root, 'var', 'tools', layout!, 'bin');
      mkdirSync(bin, { recursive: true });
      for (const command of ['ffmpeg', 'ffprobe'])
        writeFileSync(
          join(bin, command),
          `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(marker)});\n`,
          { mode: 0o700 },
        );
    }
    for (const command of ['ffmpeg', 'ffprobe']) {
      const child = spawnSync(command, ['-version'], {
        env: isolatedTestEnvironment(root, { PATH: '/usr/bin:/bin' }),
        encoding: 'utf8',
      });
      expect(child.status, child.error?.message).toBe(0);
      expect(child.stdout).toBe('current-fixture');
    }
  });

  it('makes stale dependencies an explicit error for both pnpm run and exec preflight', () => {
    // This is the workspace-level policy read by pnpm before any package script starts.
    // Do not invoke a package manager from a regression test or let it modify dependencies.
    const config = readFileSync(resolve('pnpm-workspace.yaml'), 'utf8');
    expect(config.match(/^verifyDepsBeforeRun:\s*(\S+)\s*$/m)?.[1]).toBe('error');
  });
});
