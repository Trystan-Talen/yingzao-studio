import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { parse } from 'dotenv';

interface LocalKeys {
  SESSION_SECRET: string;
  PROVIDER_ENCRYPTION_KEY: string;
}

function readKeys(path: string): LocalKeys {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LocalKeys>;
    if (
      ![value.SESSION_SECRET, value.PROVIDER_ENCRYPTION_KEY].every(
        (key) => typeof key === 'string' && key.length >= 32 && key === key.trim(),
      )
    )
      throw new Error('INVALID');
    return value as LocalKeys;
  } catch {
    throw new Error('真实模式本机密钥配置无效；请保留原文件并核对，不能重新生成密钥覆盖已有凭据。');
  }
}

/** Prepares files and explicit process environment only; never opens a database. */
export function prepareRealLaunch(
  platformDirectory: string,
  supplied: NodeJS.ProcessEnv = process.env,
) {
  const platformDir = resolve(platformDirectory);
  const runtimeDir = join(platformDir, 'var', 'real-mode');
  const keyFile = join(runtimeDir, 'local-config.json');
  const databasePath = join(platformDir, 'var', 'app.sqlite');
  const storageDir = join(platformDir, 'var', 'media');
  const baseEnvFile = join(platformDir, '.env');
  const baseEnv = existsSync(baseEnvFile) ? parse(readFileSync(baseEnvFile)) : {};
  const inherited = { ...baseEnv, ...supplied };
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  if (!existsSync(keyFile)) {
    const fallbackPath = join(platformDir, 'var', '.installation-key');
    // An existing installation may have encrypted credentials with its legacy local key.
    // Preserve that key instead of silently making the database's secrets unreadable.
    const legacy =
      existsSync(databasePath) && existsSync(fallbackPath)
        ? readFileSync(fallbackPath, 'utf8').trim()
        : undefined;
    const session = inherited.SESSION_SECRET || legacy;
    const encryption = inherited.PROVIDER_ENCRYPTION_KEY || inherited.ENCRYPTION_KEY || legacy;
    if (existsSync(databasePath) && (!session || !encryption))
      throw new Error(
        '已存在真实数据库，但未找到完整原密钥配置。请先恢复原签名与加密密钥，不能生成新密钥替换。',
      );
    const keys: LocalKeys = {
      SESSION_SECRET: session || randomBytes(32).toString('hex'),
      PROVIDER_ENCRYPTION_KEY: encryption || randomBytes(32).toString('hex'),
    };
    if (Object.values(keys).some((key) => key.length < 32 || key !== key.trim()))
      throw new Error('已有签名或加密密钥格式不符合要求，请核对本机配置。');
    try {
      writeFileSync(keyFile, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
  }
  if ((statSync(keyFile).mode & 0o077) !== 0)
    throw new Error('真实模式密钥文件权限过宽，请将其权限设为仅当前用户可读写后重试。');
  const keys = readKeys(keyFile);
  const mediaBin = join(platformDir, 'var', 'tools', 'native-media', 'bin');
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    ...keys,
    // The application currently reads ENCRYPTION_KEY; retain the more explicit launcher name.
    ENCRYPTION_KEY: keys.PROVIDER_ENCRYPTION_KEY,
    DOTENV_CONFIG_PATH: '/dev/null',
    NODE_ENV: 'development',
    DEMO_MODE: 'false',
    HOST: '127.0.0.1',
    PORT: '4316',
    PUBLIC_ORIGIN: 'http://127.0.0.1:5176',
    DATABASE_PATH: databasePath,
    STORAGE_DIR: storageDir,
    PATH: `${mediaBin}${delimiter}${inherited.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'}`,
  };
  // Vite receives no provider/session secrets and reads no unrelated .env files.
  const webEnv: NodeJS.ProcessEnv = Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL'].flatMap((key) =>
      env[key] === undefined ? [] : [[key, env[key]]],
    ),
  );
  webEnv.NODE_ENV = 'development';
  const viteConfigFile = join(runtimeDir, 'vite.config.mts');
  writeFileSync(
    viteConfigFile,
    `import base from ${JSON.stringify(join(platformDir, 'vite.config.ts'))};\n` +
      `export default { ...base, envDir: ${JSON.stringify(runtimeDir)}, server: { ...base.server, host: '127.0.0.1', port: 5176, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:4316', changeOrigin: false } }, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/var/**'] } } };\n`,
    { mode: 0o600 },
  );
  return {
    platformDir,
    runtimeDir,
    keyFile,
    databasePath,
    storageDir,
    viteConfigFile,
    env,
    webEnv,
  };
}
