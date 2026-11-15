import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app';
import type { Actor } from '../src/contracts/core';

let folder: string;
let application: Awaited<ReturnType<typeof createApp>>;
let owner: Actor;
let wid: string;
let collectionId: string;
let cookie: string;
let assetIds: string[];
const origin = 'http://127.0.0.1:4310';

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-collection-membership-'));
  application = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: origin,
      databasePath: join(folder, 'test.sqlite'),
      storageDir: join(folder, 'media'),
      sessionSecret: 'isolated-collection-session',
      encryptionKey: 'isolated-collection-encryption',
      isProduction: false,
      demoMode: false,
      environmentSecrets: {},
    },
    { serveWeb: false },
  );
  const registered = await application.services.core.auth.register({
    email: 'collection-owner@example.local',
    password: 'CollectionPassword2026!',
    displayName: 'Collection owner',
  });
  owner = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registered.workspace.id;
  cookie = `studio_session=${registered.sessionToken}`;
  collectionId = application.services.core.references.createCollection(owner, wid, {
    name: 'Collection',
  }).id;
  assetIds = [];
  for (let index = 0; index < 3; index++) {
    const asset = await application.services.core.assets.ingest(owner, wid, {
      name: `asset-${index}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(`isolated collection fixture ${index}`),
    });
    assetIds.push(asset.id);
  }
});

afterEach(async () => {
  await application?.app.close();
  await rm(folder, { recursive: true, force: true });
});

function patch(
  payload: Record<string, unknown>,
  options: { cookie?: string; wid?: string; id?: string } = {},
) {
  return application.app.inject({
    method: 'PATCH',
    url: `/api/v1/collections/${options.id ?? collectionId}/assets`,
    headers: { origin, cookie: options.cookie ?? cookie, 'x-workspace-id': options.wid ?? wid },
    payload,
  });
}

function members(): string[] {
  return (
    application.services.db.sqlite
      .prepare('SELECT asset_id FROM asset_collections WHERE collection_id=? ORDER BY asset_id')
      .all(collectionId) as { asset_id: string }[]
  ).map((row) => row.asset_id);
}

describe('atomic collection membership', () => {
  it('keeps recycled memberships when adding another asset and restores the original membership', async () => {
    const core = application.services.core;
    core.references.setCollectionAssets(owner, wid, collectionId, { assetIds: [assetIds[0]] });
    core.assets.remove(owner, wid, assetIds[0]!);
    const result = await patch({ addAssetIds: [assetIds[1]] });
    expect(result.statusCode, result.body).toBe(200);
    expect(members()).toEqual([assetIds[0], assetIds[1]].sort());
    core.assets.restore(owner, wid, assetIds[0]!);
    expect(
      core.assets
        .list(owner, wid, { collectionId })
        .items.map((asset) => asset.id)
        .sort(),
    ).toEqual([assetIds[0], assetIds[1]].sort());
  });

  it('preserves independent additions from simultaneous clients and supports safe retries', async () => {
    const results = await Promise.all([
      patch({ addAssetIds: [assetIds[0]] }),
      patch({ addAssetIds: [assetIds[1]] }),
      patch({ addAssetIds: [assetIds[0], assetIds[0]] }),
    ]);
    for (const result of results) expect(result.statusCode, result.body).toBe(200);
    expect(members()).toEqual([assetIds[0], assetIds[1]].sort());
  });

  it('removes only named memberships, including recycled assets, without disturbing others', async () => {
    const core = application.services.core;
    core.references.setCollectionAssets(owner, wid, collectionId, { assetIds });
    core.assets.remove(owner, wid, assetIds[0]!);
    core.assets.remove(owner, wid, assetIds[2]!);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await patch({ removeAssetIds: [assetIds[0], assetIds[1]] });
      expect(result.statusCode, result.body).toBe(200);
      expect(members()).toEqual([assetIds[2]]);
    }
  });

  it('validates the entire delta before changing membership and rejects cross-workspace assets', async () => {
    const core = application.services.core;
    core.references.setCollectionAssets(owner, wid, collectionId, { assetIds: [assetIds[0]] });
    const other = core.auth.createWorkspace(owner.userId, 'Other workspace', 'personal');
    const foreign = await core.assets.ingest(owner, other.id, {
      name: 'foreign.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('foreign fixture'),
    });
    for (const payload of [
      { addAssetIds: [assetIds[1], foreign.id], removeAssetIds: [assetIds[0]] },
      { addAssetIds: [assetIds[1]], removeAssetIds: [foreign.id] },
      { addAssetIds: [assetIds[1], randomUUID()], removeAssetIds: [assetIds[0]] },
    ]) {
      const result = await patch(payload);
      expect(result.statusCode, result.body).toBe(404);
      expect(members()).toEqual([assetIds[0]]);
    }
    const wrongWorkspace = await patch({ addAssetIds: [foreign.id] }, { wid: other.id });
    expect(wrongWorkspace.statusCode, wrongWorkspace.body).toBe(404);
    expect(members()).toEqual([assetIds[0]]);
  });

  it('rejects deleted additions, missing changes, ambiguous deltas and oversized payloads', async () => {
    application.services.core.assets.remove(owner, wid, assetIds[0]!);
    expect((await patch({ addAssetIds: [assetIds[0]] })).statusCode).toBe(404);
    for (const payload of [
      {},
      { addAssetIds: [], removeAssetIds: [] },
      { addAssetIds: [assetIds[1]], removeAssetIds: [assetIds[1]] },
      { addAssetIds: Array.from({ length: 501 }, () => assetIds[1]) },
      { addAssetIds: ['invalid-id'] },
      { assetIds: [assetIds[1]] },
    ]) {
      const result = await patch(payload);
      expect(result.statusCode, result.body).toBe(400);
    }
    expect(members()).toEqual([]);
  });

  it('requires write access and an active collection', async () => {
    application.services.db.sqlite
      .prepare("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?")
      .run(wid, owner.userId);
    expect((await patch({ addAssetIds: [assetIds[0]] })).statusCode).toBe(403);
    application.services.db.sqlite
      .prepare("UPDATE memberships SET role='owner' WHERE workspace_id=? AND user_id=?")
      .run(wid, owner.userId);
    expect((await patch({ addAssetIds: [assetIds[0]] }, { cookie: '' })).statusCode).toBe(401);
    application.services.core.references.removeCollection(owner, wid, collectionId);
    expect((await patch({ addAssetIds: [assetIds[0]] })).statusCode).toBe(404);
    expect(members()).toEqual([]);
  });

  it('keeps the explicit full-replacement endpoint compatible', async () => {
    const response = await application.app.inject({
      method: 'PUT',
      url: `/api/v1/collections/${collectionId}/assets`,
      headers: { origin, cookie, 'x-workspace-id': wid },
      payload: { assetIds: [assetIds[0], assetIds[0]] },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(members()).toEqual([assetIds[0]]);
  });

  it('enforces the 500-member limit while allowing no-op retries and a same-size replacement', async () => {
    const core = application.services.core;
    const existing = [assetIds[0]!, ...Array.from({ length: 499 }, () => randomUUID())];
    const copy = application.services.db.sqlite.prepare(
      `INSERT INTO assets(id,workspace_id,name,kind,mime_type,byte_size,source,tags_json,sha256,created_by,created_at,updated_at)
       SELECT ?,workspace_id,name,kind,mime_type,byte_size,source,tags_json,sha256,created_by,created_at,updated_at FROM assets WHERE id=?`,
    );
    application.services.db.sqlite.transaction(() => {
      for (const id of existing.slice(1)) copy.run(id, assetIds[0]);
    })();
    core.references.setCollectionAssets(owner, wid, collectionId, { assetIds: existing });
    core.assets.remove(owner, wid, existing[1]!);

    const overCapacity = await patch({ addAssetIds: [assetIds[1]] });
    expect(overCapacity.statusCode, overCapacity.body).toBe(409);
    expect(overCapacity.json().error.code).toBe('COLLECTION_ASSET_LIMIT');
    expect(members()).toEqual([...existing].sort());

    const retry = await patch({ addAssetIds: [assetIds[0], assetIds[0]] });
    expect(retry.statusCode, retry.body).toBe(200);
    expect(members()).toHaveLength(500);

    const replacement = await patch({ addAssetIds: [assetIds[1]], removeAssetIds: [existing[1]] });
    expect(replacement.statusCode, replacement.body).toBe(200);
    expect(members()).toEqual([...existing.filter((id) => id !== existing[1]), assetIds[1]].sort());

    core.assets.restore(owner, wid, existing[1]!);
    const invalidBatch = await patch({
      addAssetIds: [existing[1], assetIds[2]],
      removeAssetIds: [assetIds[1]],
    });
    expect(invalidBatch.statusCode, invalidBatch.body).toBe(409);
    expect(members()).toHaveLength(500);
    expect(members()).toContain(assetIds[1]);
    expect(members()).not.toContain(existing[1]);

    expect((await patch({ removeAssetIds: [existing[2]] })).statusCode).toBe(200);
    const concurrent = await Promise.all([
      patch({ addAssetIds: [existing[1]] }),
      patch({ addAssetIds: [assetIds[2]] }),
    ]);
    expect(concurrent.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect(members()).toHaveLength(500);
  });
});
