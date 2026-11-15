import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRealLaunch } from '../scripts/real-launch-environment';

const temporary: string[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'yingzao-real-launch-'));
  temporary.push(path);
  return path;
}
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('real launcher isolation and stable keys', () => {
  it('generates stable private local keys without opening a database or leaking them to Vite', () => {
    const root = directory();
    const first = prepareRealLaunch(root, {
      PATH: '/usr/bin:/bin',
      DEMO_MODE: 'true',
      DATABASE_PATH: '/unrelated/database.sqlite',
    });
    const second = prepareRealLaunch(root, {
      SESSION_SECRET: 'later-session-value'.repeat(3),
      ENCRYPTION_KEY: 'later-encryption-value'.repeat(3),
    });
    expect(first.env.DEMO_MODE).toBe('false');
    expect(first.env.DATABASE_PATH).toBe(join(root, 'var/app.sqlite'));
    expect(first.env.STORAGE_DIR).toBe(join(root, 'var/media'));
    expect(first.env.PORT).toBe('4316');
    expect(first.env.PUBLIC_ORIGIN).toBe('http://127.0.0.1:5176');
    expect(first.env.SESSION_SECRET).toHaveLength(64);
    expect(first.env.ENCRYPTION_KEY).not.toBe(first.env.SESSION_SECRET);
    expect(first.env.ENCRYPTION_KEY).toBe(first.env.PROVIDER_ENCRYPTION_KEY);
    expect(second.env.SESSION_SECRET).toBe(first.env.SESSION_SECRET);
    expect(second.env.ENCRYPTION_KEY).toBe(first.env.ENCRYPTION_KEY);
    expect(statSync(first.keyFile).mode & 0o777).toBe(0o600);
    expect(first.webEnv.SESSION_SECRET).toBeUndefined();
    expect(first.webEnv.ENCRYPTION_KEY).toBeUndefined();
    expect(first.webEnv.PROVIDER_ENCRYPTION_KEY).toBeUndefined();
    expect(existsSync(first.databasePath)).toBe(false);
    expect(existsSync(first.storageDir)).toBe(false);
    expect(readFileSync(first.viteConfigFile, 'utf8')).toContain("'**/var/**'");
    expect(readFileSync(first.viteConfigFile, 'utf8')).toContain('http://127.0.0.1:4316');
  });

  it('preserves existing environment secrets without modifying the original configuration', () => {
    const root = directory();
    const envText = `SESSION_SECRET=${'fixture-session-'.repeat(3)}\nENCRYPTION_KEY=${'fixture-encryption-'.repeat(3)}\nOPENAI_API_KEY=fixture-only-not-a-live-key\n`;
    writeFileSync(join(root, '.env'), envText);
    const prepared = prepareRealLaunch(root, {});
    expect(prepared.env.SESSION_SECRET).toBe('fixture-session-'.repeat(3));
    expect(prepared.env.ENCRYPTION_KEY).toBe('fixture-encryption-'.repeat(3));
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(envText);
    expect(prepared.webEnv.OPENAI_API_KEY).toBeUndefined();
  });

  it('retains a legacy real database key rather than silently replacing its encryption key', () => {
    const root = directory();
    mkdirSync(join(root, 'var'));
    writeFileSync(join(root, 'var/app.sqlite'), 'untouched-database-placeholder');
    writeFileSync(join(root, 'var/.installation-key'), 'legacy-key-value-'.repeat(4));
    const prepared = prepareRealLaunch(root, {});
    expect(prepared.env.ENCRYPTION_KEY).toBe('legacy-key-value-'.repeat(4));
    expect(readFileSync(prepared.databasePath, 'utf8')).toBe('untouched-database-placeholder');
  });

  it('refuses to generate replacement keys for an existing database with missing key provenance', () => {
    const root = directory();
    mkdirSync(join(root, 'var'));
    writeFileSync(join(root, 'var/app.sqlite'), 'untouched-database-placeholder');
    expect(() => prepareRealLaunch(root, {})).toThrow('未找到完整原密钥配置');
    expect(existsSync(join(root, 'var/real-mode/local-config.json'))).toBe(false);
    expect(readFileSync(join(root, 'var/app.sqlite'), 'utf8')).toBe(
      'untouched-database-placeholder',
    );
  });

  it('does not overwrite a malformed existing local configuration', () => {
    const root = directory();
    const prepared = prepareRealLaunch(root, {});
    writeFileSync(prepared.keyFile, '{broken');
    expect(() => prepareRealLaunch(root, {})).toThrow('本机密钥配置无效');
    expect(readFileSync(prepared.keyFile, 'utf8')).toBe('{broken');
  });
});
