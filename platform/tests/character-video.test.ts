import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { Actor } from '../src/contracts/core';
import type { AppConfig } from '../src/server/config';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import { createCreditService } from '../src/server/tasks/credits';
import { createTaskServices } from '../src/server/tasks/service';
import { jobInputSchema } from '../src/contracts/jobs';

let folder: string,
  db: DatabaseContext,
  core: CoreServices,
  config: AppConfig,
  actor: Actor,
  wid: string;
let video: Buffer, image: Buffer;
const authorization = {
  acknowledged: true,
  statementVersion: 'reference-use-v1',
  subjectRelationship: 'self',
};
beforeAll(async () => {
  const f = await mkdtemp(join(tmpdir(), 'character-video-fixture-'));
  try {
    const file = join(f, 'character.mp4');
    await promisify(execFile)('ffmpeg', [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=160x120:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-y',
      file,
    ]);
    video = await readFile(file);
    image = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#428965' } })
      .png()
      .toBuffer();
  } finally {
    await rm(f, { recursive: true, force: true });
  }
});
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'character-video-'));
  db = createDatabaseContext(join(folder, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'fixture-only',
    encryptionKey: 'fixture-only',
    isProduction: false,
    demoMode: false,
    environmentSecrets: { openai: 'fixture-not-a-real-key' },
  };
  const credits = createCreditService(db);
  core = createCoreServices(db, config, {
    onWorkspaceCreated: (w, u) => credits.initialize(w, u, 100),
  });
  const user = await core.auth.register({
    email: 'owner@example.test',
    password: 'CharacterFixture2026!',
    displayName: 'Owner',
  });
  actor = {
    userId: user.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = user.workspace.id;
});
afterEach(async () => {
  closeDatabase(db);
  await rm(folder, { recursive: true, force: true });
});
async function media() {
  const photo = await core.assets.ingest(actor, wid, {
    buffer: image,
    name: '人物图.png',
    mimeType: 'image/png',
  });
  const clip = await core.assets.ingest(actor, wid, {
    buffer: video,
    name: '人物视频.mp4',
    mimeType: 'video/mp4',
  });
  return { photo, clip };
}
it('stores and reloads mixed image/video references and a video cover without asserting identity verification', async () => {
  const { photo, clip } = await media();
  const person = core.references.createCharacter(actor, wid, {
    name: '混合人物',
    referenceAssetIds: [photo.id, clip.id],
    coverAssetId: clip.id,
  });
  const reopened = createDatabaseContext(config.databasePath);
  try {
    const read = createCoreServices(reopened, config).references.getCharacter(
      actor,
      wid,
      person.id,
    );
    expect(read.referenceAssetIds).toEqual([photo.id, clip.id]);
    expect(read.coverAssetId).toBe(clip.id);
    expect(read.verification.status).toBe('unverified');
    expect(read.authorization.status).toBe('not-declared');
    expect((await core.assets.readOriginal(actor, wid, clip.id)).buffer).toEqual(video);
  } finally {
    closeDatabase(reopened);
  }
});
it('invalidates the old authorization and verification when a video reference is added, while preserving renames', async () => {
  const { photo, clip } = await media();
  const person = core.references.createCharacter(actor, wid, {
    name: 'Person',
    referenceAssetIds: [photo.id],
  });
  core.identity.authorize(actor, wid, person.id, authorization);
  const changed = core.references.updateCharacter(actor, wid, person.id, {
    referenceAssetIds: [photo.id, clip.id],
  });
  expect(changed.authorization).toMatchObject({ status: 'stale', referenceRevision: 2 });
  expect(changed.verification.status).toBe('unverified');
  core.identity.authorize(actor, wid, person.id, authorization);
  expect(
    core.references.updateCharacter(actor, wid, person.id, { name: 'Renamed' }).authorization
      .status,
  ).toBe('active');
});
it('rejects foreign, removed and nonvisual assets without changing the stored profile or allowing brands to use video', async () => {
  const { photo, clip } = await media();
  const other = core.auth.createWorkspace(actor.userId, 'Other', 'team');
  expect(() =>
    core.references.createCharacter(actor, other.id, {
      name: 'Foreign',
      referenceAssetIds: [clip.id],
    }),
  ).toThrow();
  expect(() =>
    core.references.createBrand(actor, wid, { name: 'Brand', referenceAssetIds: [clip.id] }),
  ).toThrow(/图片/);
  const doc = await core.assets.ingest(actor, wid, {
    buffer: Buffer.from('plain text'),
    name: 'notes.txt',
    mimeType: 'text/plain',
  });
  const person = core.references.createCharacter(actor, wid, {
    name: 'Person',
    referenceAssetIds: [photo.id],
  });
  expect(() =>
    core.references.updateCharacter(actor, wid, person.id, { referenceAssetIds: [doc.id] }),
  ).toThrow();
  core.assets.remove(actor, wid, clip.id);
  expect(() =>
    core.references.updateCharacter(actor, wid, person.id, {
      referenceAssetIds: [photo.id, clip.id],
    }),
  ).toThrow();
  expect(core.references.getCharacter(actor, wid, person.id).referenceAssetIds).toEqual([photo.id]);
});
it('preserves deleted reference IDs until explicit removal and refuses their later use', async () => {
  const { clip } = await media();
  const person = core.references.createCharacter(actor, wid, {
    name: 'Person',
    referenceAssetIds: [clip.id],
  });
  core.identity.authorize(actor, wid, person.id, authorization);
  core.assets.remove(actor, wid, clip.id);
  expect(core.references.getCharacter(actor, wid, person.id).referenceAssetIds).toEqual([clip.id]);
  expect(() => core.identity.assertCanReference(actor, wid, person.id)).toThrow();
  expect(() => core.identity.authorize(actor, wid, person.id, authorization)).toThrow();
  const cleaned = core.references.updateCharacter(actor, wid, person.id, {
    referenceAssetIds: [],
    coverAssetId: null,
  });
  expect(cleaned.referenceAssetIds).toEqual([]);
  expect(cleaned.authorization.status).toBe('stale');
});
it('keeps original media on profile deletion and enforces viewer/cross-space permissions', async () => {
  const { clip } = await media();
  const person = core.references.createCharacter(actor, wid, {
    name: 'Person',
    referenceAssetIds: [clip.id],
  });
  const other = core.auth.createWorkspace(actor.userId, 'Other', 'team');
  expect(() => core.references.getCharacter(actor, other.id, person.id)).toThrow();
  db.sqlite
    .prepare("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?")
    .run(wid, actor.userId);
  expect(core.references.getCharacter(actor, wid, person.id).name).toBe('Person');
  expect(() =>
    core.references.updateCharacter(actor, wid, person.id, { name: 'Changed' }),
  ).toThrow();
  expect(() => core.references.removeCharacter(actor, wid, person.id)).toThrow();
  db.sqlite
    .prepare("UPDATE memberships SET role='owner' WHERE workspace_id=? AND user_id=?")
    .run(wid, actor.userId);
  core.references.removeCharacter(actor, wid, person.id);
  expect(() => core.references.getCharacter(actor, wid, person.id)).toThrow();
  expect((await core.assets.readOriginal(actor, wid, clip.id)).buffer).toEqual(video);
});
it('rejects the whole mixed character in current image model input without a quote, job or credit reservation', async () => {
  const { photo, clip } = await media();
  const person = core.references.createCharacter(actor, wid, {
    name: 'Person',
    referenceAssetIds: [photo.id, clip.id],
  });
  core.identity.authorize(actor, wid, person.id, authorization);
  const tasks = createTaskServices(db, core, config);
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: 'Retain this draft',
    characterId: person.id,
    characterRevision: person.authorization.referenceRevision,
  });
  expect(() => tasks.quote(actor, wid, input)).toThrow(/人物视频参考尚不能用于当前创作/);
  expect(db.sqlite.prepare('SELECT count(*) n FROM quotes').get()).toEqual({ n: 0 });
  expect(db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  expect(
    db.sqlite
      .prepare(
        "SELECT reserved FROM credit_accounts WHERE workspace_id=? AND billing_channel='web'",
      )
      .get(wid),
  ).toEqual({ reserved: 0 });
  expect(core.references.getCharacter(actor, wid, person.id).referenceAssetIds).toEqual([
    photo.id,
    clip.id,
  ]);
});
it('keeps image-only quotation working and rejects a saved quote after the profile acquires video references', async () => {
  const { photo, clip } = await media();
  const person = core.references.createCharacter(actor, wid, {
    name: 'Image profile',
    referenceAssetIds: [photo.id],
  });
  core.identity.authorize(actor, wid, person.id, authorization);
  const tasks = createTaskServices(db, core, config);
  const draft = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: 'Saved image draft remains intact',
    characterId: person.id,
    characterRevision: 1,
  });
  const before = structuredClone(draft);
  const quote = tasks.quote(actor, wid, draft);
  expect(quote.items).toBeDefined();
  expect(quote.items?.[0]?.referenceAssetIds).toEqual([photo.id]);
  core.references.updateCharacter(actor, wid, person.id, {
    referenceAssetIds: [photo.id, clip.id],
  });
  core.identity.authorize(actor, wid, person.id, authorization);
  expect(() => tasks.submit(actor, wid, draft, quote.id, randomUUID())).toThrow(
    /人物素材版本已变更/,
  );
  expect(draft).toEqual(before);
  expect(db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});
