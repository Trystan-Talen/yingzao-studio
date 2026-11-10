import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, access, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { backup } from '../scripts/backup';
import { restore } from '../scripts/restore';

let folder: string;
let config: AppConfig;
let application: Awaited<ReturnType<typeof createApp>>;
let original: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-backup-integrity-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:4310',
    databasePath: join(folder, 'live.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'isolated-backup-session',
    encryptionKey: 'isolated-backup-encryption',
    isProduction: false,
    demoMode: false,
    environmentSecrets: {},
  };
  application = await createApp(config, { serveWeb: false });
  const account = await application.services.core.auth.register({
    email: 'backup@example.test',
    password: 'BackupFixture2026!',
    displayName: '备份回归',
  });
  const asset = await application.services.core.assets.ingest(
    {
      userId: account.user.id,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    account.workspace.id,
    {
      buffer: Buffer.from('Original backup evidence.'),
      name: 'evidence.txt',
      mimeType: 'text/plain',
    },
  );
  original = (
    application.services.db.sqlite
      .prepare("SELECT storage_key FROM asset_variants WHERE asset_id=? AND variant='original'")
      .get(asset.id) as { storage_key: string }
  ).storage_key;
});
afterEach(async () => {
  await application.app.close();
  await rm(folder, { recursive: true, force: true });
});

describe('recoverable backups', () => {
  it('rejects nested destinations reached through a parent symlink before staging data', async () => {
    const alias = join(folder, 'media-alias');
    await symlink(config.storageDir, alias);
    await expect(backup(config, join(alias, 'nested', 'backup'))).rejects.toThrow('媒体目录之外');
    expect(await readdir(config.storageDir)).not.toContain('nested');
    const source = await backup(config, join(folder, 'backup'));
    const sourceAlias = join(folder, 'backup-alias');
    await symlink(source, sourceAlias);
    await expect(restore(source, join(sourceAlias, 'nested', 'restore'))).rejects.toThrow(
      '备份目录之外',
    );
    expect(await readdir(source)).not.toContain('nested');
  });
  it('rejects a destination nested inside media before copying recursively', async () => {
    await expect(backup(config, join(config.storageDir, 'backup'))).rejects.toThrow('媒体目录之外');
    await expect(access(join(config.storageDir, 'backup'))).rejects.toThrow();
    const source = await backup(config, join(folder, 'backup'));
    await expect(restore(source, join(source, 'media', 'restored'))).rejects.toThrow(
      '备份目录之外',
    );
  });
  it('publishes only one of two simultaneous restores to the same destination', async () => {
    const source = await backup(config, join(folder, 'backup'));
    const destination = join(folder, 'restored');
    const results = await Promise.allSettled([
      restore(source, destination),
      restore(source, destination),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await readFile(join(destination, 'media', original))).toEqual(
      await readFile(join(config.storageDir, original)),
    );
  });
  it('rejects equal-length corrupted originals and leaves no restored directory', async () => {
    const source = await backup(config, join(folder, 'backup'));
    const file = join(source, 'media', original);
    const bytes = await readFile(file);
    bytes[0] = bytes[0]! ^ 1;
    await writeFile(file, bytes);
    await expect(restore(source, join(folder, 'restored'))).rejects.toThrow(/校验|摘要|完整性/);
    await expect(access(join(folder, 'restored'))).rejects.toThrow();
    expect((await readdir(folder)).some((name) => name.includes('.staging-'))).toBe(false);
  });
  it('detects modified encryption keys before publishing a restored copy', async () => {
    const source = await backup(config, join(folder, 'backup'));
    await writeFile(
      join(source, 'keys.json'),
      JSON.stringify({ sessionSecret: config.sessionSecret, encryptionKey: 'replacement-key' }),
    );
    await expect(restore(source, join(folder, 'restored'))).rejects.toThrow(/校验|摘要|完整性/);
  });
  it('rejects corrupted source media instead of declaring a successful backup', async () => {
    const file = join(config.storageDir, original);
    const bytes = await readFile(file);
    bytes[0] = bytes[0]! ^ 1;
    await writeFile(file, bytes);
    await expect(backup(config, join(folder, 'backup'))).rejects.toThrow(/校验|摘要|完整性/);
    await expect(access(join(folder, 'backup'))).rejects.toThrow();
  });
  it('never creates a missing source database as a side effect of backing up', async () => {
    const missing = join(folder, 'missing.sqlite');
    await expect(
      backup({ ...config, databasePath: missing }, join(folder, 'backup')),
    ).rejects.toThrow();
    await expect(access(missing)).rejects.toThrow();
  });
  it('writes a checksum manifest and restores the same source bytes', async () => {
    const source = await backup(config, join(folder, 'backup'));
    const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'database.sqlite',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({ path: 'keys.json' }),
        expect.objectContaining({ path: `media/${original}` }),
      ]),
    );
    const restored = await restore(source, join(folder, 'restored'));
    expect(await readFile(join(restored, 'media', original))).toEqual(
      await readFile(join(config.storageDir, original)),
    );
    await expect(restore(source, restored)).rejects.toThrow('恢复目标已存在');
  });
  it('still restores legacy backups and verifies their original asset digest', async () => {
    const source = await backup(config, join(folder, 'backup'));
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ formatVersion: 1 }));
    await restore(source, join(folder, 'legacy-restored'));
    const file = join(source, 'media', original);
    const bytes = await readFile(file);
    bytes[0] = bytes[0]! ^ 1;
    await writeFile(file, bytes);
    await expect(restore(source, join(folder, 'legacy-corrupt'))).rejects.toThrow(
      /校验|摘要|完整性/,
    );
  });
  it('refuses symlinks in source media', async () => {
    await symlink(join(folder, 'live.sqlite'), join(config.storageDir, 'linked-private-file'));
    await expect(backup(config, join(folder, 'backup'))).rejects.toThrow(/符号链接|普通文件/);
  });
});
