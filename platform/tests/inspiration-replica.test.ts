/** Video reuse must save a recoverable action-reference draft, never invoke a model. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import type { Actor } from '../src/contracts/core';
let folder: string,
  instance: Awaited<ReturnType<typeof createApp>>,
  cookie: string,
  wid: string,
  actor: Actor;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'inspiration-replica-'));
  instance = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(folder, 'fixture.sqlite'),
      storageDir: join(folder, 'media'),
      sessionSecret: 'fixture',
      encryptionKey: 'fixture',
      demoMode: false,
      isProduction: false,
      environmentSecrets: {},
    } as AppConfig,
    { serveWeb: false },
  );
  const response = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'video-reuse@example.test',
      displayName: 'Video reuse fixture',
      password: 'VideoReuseFixture2026!',
    },
  });
  expect(response.statusCode).toBe(201);
  cookie = String(response.headers['set-cookie']).split(';')[0]!;
  const user = response.json().data;
  wid = user.workspace.id;
  actor = {
    userId: user.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
});
afterEach(async () => {
  await instance.app.close();
  await rm(folder, { recursive: true, force: true });
});
const headers = () => ({ cookie, origin: 'http://127.0.0.1:5174', 'x-workspace-id': wid });
it('rejects unknown video content categories instead of silently ignoring the requested filter', async () => {
  const response = await instance.app.inject({
    url: '/api/v1/inspirations?kind=video&videoCategory=unknown',
    headers: headers(),
  });
  expect(response.statusCode).toBe(400);
});
async function example(seconds: number) {
  const file = join(folder, 'synthetic.mp4');
  await promisify(execFile)(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=blue:s=360x360:r=20:d=${seconds}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-y',
      file,
    ],
    { timeout: 30000 },
  );
  const asset = await instance.services.core.assets.ingest(actor, wid, {
    buffer: await readFile(file),
    name: 'owned-synthetic.mp4',
    mimeType: 'video/mp4',
  });
  const response = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/inspirations',
    headers: headers(),
    payload: {
      title: '本机合成视频灵感',
      category: '人物动作',
      kind: 'video',
      tag: '本机回归',
      ratio: '1:1',
      prompt: '保持主体外观，参考视频动作',
      source: '本机合成，不使用第三方原件',
      assetId: asset.id,
      options: { model: 'kling-o3-4k-reference', resolution: '4K', duration: 5 },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return { inspiration: response.json().data, asset };
}
it('persists video categories independently from industry, combines filters and keeps legacy entries unclassified', async () => {
  const { inspiration, asset } = await example(3);
  const sql = instance.services.db.sqlite;
  const original = sql
    .prepare('SELECT data_json FROM inspirations WHERE id=?')
    .get(inspiration.id) as { data_json: string };
  expect(JSON.parse(original.data_json)).not.toHaveProperty('videoCategory');
  const ids: string[] = [];
  for (const videoCategory of ['talking-head', 'recommendation', 'brand', 'story']) {
    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/inspirations',
      headers: headers(),
      payload: {
        ...JSON.parse(original.data_json),
        title: `分类样本 ${videoCategory}`,
        videoCategory,
        assetId: asset.id,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().data.videoCategory).toBe(videoCategory);
    ids.push(response.json().data.id);
  }
  const list = async (query: string) =>
    (
      await instance.app.inject({
        url: `/api/v1/inspirations?kind=video${query}`,
        headers: headers(),
      })
    ).json().data;
  expect((await list('')).total).toBe(5);
  expect(
    (await list('')).items.find((item: { id: string }) => item.id === inspiration.id).videoCategory,
  ).toBeNull();
  expect(
    (
      await list(
        '&videoCategory=brand&category=%E4%BA%BA%E7%89%A9%E5%8A%A8%E4%BD%9C&q=brand&pageSize=1',
      )
    ).items.map((item: { id: string }) => item.id),
  ).toEqual([ids[2]]);
  expect((await list('&videoCategory=brand&category=absent')).total).toBe(0);
  await instance.app.inject({
    method: 'PUT',
    url: `/api/v1/inspirations/${ids[2]}/favorite`,
    headers: headers(),
    payload: { favorite: true },
  });
  expect((await list('&videoCategory=brand&favorite=true')).total).toBe(1);
  expect((await list('&videoCategory=story&favorite=true')).total).toBe(0);
  await instance.app.inject({
    method: 'PATCH',
    url: `/api/v1/inspirations/${ids[2]}`,
    headers: headers(),
    payload: { archived: true },
  });
  expect((await list('&videoCategory=brand')).total).toBe(0);
  expect((await list('&videoCategory=brand&archived=true')).total).toBe(1);
  expect(sql.prepare('SELECT data_json FROM inspirations WHERE id=?').get(inspiration.id)).toEqual(
    original,
  );
});
it('edits and clears only the requested category, preserving metadata and workspace authorization', async () => {
  const { inspiration } = await example(3),
    sql = instance.services.db.sqlite;
  const old = JSON.parse(
    (
      sql.prepare('SELECT data_json FROM inspirations WHERE id=?').get(inspiration.id) as {
        data_json: string;
      }
    ).data_json,
  );
  const patch = (payload: Record<string, unknown>, workspaceId = wid) =>
    instance.app.inject({
      method: 'PATCH',
      url: `/api/v1/inspirations/${inspiration.id}`,
      headers: { ...headers(), 'x-workspace-id': workspaceId },
      payload,
    });
  expect((await patch({ videoCategory: 'story' })).json().data.videoCategory).toBe('story');
  const stored = () =>
    JSON.parse(
      (
        sql.prepare('SELECT data_json FROM inspirations WHERE id=?').get(inspiration.id) as {
          data_json: string;
        }
      ).data_json,
    );
  expect(stored()).toEqual({ ...old, videoCategory: 'story' });
  expect((await patch({ archived: true })).statusCode).toBe(200);
  expect(stored()).toEqual({ ...old, videoCategory: 'story' });
  expect((await patch({ videoCategory: null })).json().data).toMatchObject({
    videoCategory: null,
    archived: true,
  });
  expect(stored()).toEqual({ ...old, videoCategory: null });
  expect((await patch({})).statusCode).toBe(400);
  expect((await patch({ videoCategory: 'invented' })).statusCode).toBe(400);
  const another = instance.services.core.auth.createWorkspace(
    actor.userId,
    'Other fixture space',
    'team',
  );
  expect((await patch({ videoCategory: 'brand' }, another.id)).statusCode).toBe(404);
  sql
    .prepare("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?")
    .run(wid, actor.userId);
  expect((await patch({ videoCategory: 'brand' })).statusCode).toBe(403);
  expect(stored()).toEqual({ ...old, videoCategory: null });
  expect(sql.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
});
it('rejects video categories on image input and refuses modifying built-in examples', async () => {
  const response = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/inspirations',
    headers: headers(),
    payload: {
      title: 'Wrong media category',
      category: 'test',
      tag: '',
      kind: 'image',
      videoCategory: 'brand',
      ratio: '1:1',
      prompt: 'test',
      source: 'local',
      assetId: randomUUID(),
    },
  });
  expect(response.statusCode, response.body).toBe(400);
  const builtin = await instance.app.inject({
    method: 'PATCH',
    url: '/api/v1/inspirations/botanical-serum',
    headers: headers(),
    payload: { videoCategory: 'brand' },
  });
  expect(builtin.statusCode).toBe(403);
});
it('atomically inherits the actual video into a dedicated motion-reference slot with intent-aware replay', async () => {
  const { inspiration, asset } = await example(15.45),
    requestId = randomUUID();
  const request = (intent: 'create' | 'replicate' = 'replicate') =>
    instance.app.inject({
      method: 'POST',
      url: `/api/v1/inspirations/${inspiration.id}/reuse`,
      headers: headers(),
      payload: { requestId, prompt: '只保存参考动作草稿', intent },
    });
  const [first, replay] = await Promise.all([request(), request()]);
  expect(first.statusCode, first.body).toBe(201);
  expect(replay.statusCode, replay.body).toBe(201);
  expect(first.json().data).toEqual(replay.json().data);
  const { project, draft } = first.json().data;
  expect(draft).toMatchObject({
    operation: 'video.motion-replica',
    providerId: 'fal',
    projectId: project.id,
    assetIds: [],
    referenceAssetIds: [asset.id],
    options: {
      model: 'kling-2.6-motion-standard',
      mode: 'exact',
      ratio: 'auto',
      resolution: 'auto',
      replacementType: 'model',
      needText: false,
      keepMusicRhythm: true,
      referenceAuthorized: false,
      externalCostAccepted: false,
      trimStart: 0,
      trimEnd: 15.45,
      duration: 16,
    },
  });
  expect(draft.creationWarnings.join(' ')).toContain('主体图片');
  const messages = await instance.app.inject({
    url: `/api/v1/projects/${project.id}/messages`,
    headers: headers(),
  });
  expect(messages.json().data.items[0].metadata.draft).toEqual(draft);
  expect((await request('create')).statusCode).toBe(409);
  const sql = instance.services.db.sqlite;
  for (const [table, n] of [
    ['projects', 1],
    ['assets', 1],
    ['inspiration_reuses', 1],
    ['jobs', 0],
  ] as const)
    expect(sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({ n });
});
it('refuses image inspiration for motion intent without leaving a project or media copy', async () => {
  const response = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/inspirations/botanical-serum/reuse',
    headers: headers(),
    payload: { requestId: randomUUID(), prompt: '不能把图片当动作参考', intent: 'replicate' },
  });
  expect(response.statusCode, response.body).toBe(400);
  expect(response.json().error.code).toBe('VIDEO_REQUIRED');
  for (const table of ['projects', 'assets', 'inspiration_reuses', 'jobs'])
    expect(instance.services.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
      n: 0,
    });
});
it.each([1500, null])(
  'rejects a too-short or unknown reference duration (%s) before making a draft',
  async (durationMs) => {
    const { inspiration, asset } = await example(3);
    instance.services.db.sqlite
      .prepare('UPDATE assets SET duration_ms=? WHERE id=?')
      .run(durationMs, asset.id);
    const response = await instance.app.inject({
      method: 'POST',
      url: `/api/v1/inspirations/${inspiration.id}/reuse`,
      headers: headers(),
      payload: { requestId: randomUUID(), prompt: '不要捏造时长', intent: 'replicate' },
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('VIDEO_DURATION_REQUIRED');
    expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM projects').get()).toEqual({
      n: 0,
    });
  },
);
it('keeps old default-create journals compatible with an explicit create intent', async () => {
  const payload = { requestId: randomUUID(), prompt: '旧草稿不需要迁移请求指纹' };
  const request = (explicit: boolean) =>
    instance.app.inject({
      method: 'POST',
      url: '/api/v1/inspirations/botanical-serum/reuse',
      headers: headers(),
      payload: { ...payload, ...(explicit ? { intent: 'create' } : {}) },
    });
  const first = await request(false),
    second = await request(true);
  expect(first.statusCode, first.body).toBe(201);
  expect(second.statusCode, second.body).toBe(201);
  expect(second.json().data).toEqual(first.json().data);
});
it('persists an explicit review warning when preselecting the first thirty seconds of a longer video', async () => {
  const { inspiration, asset } = await example(31);
  const response = await instance.app.inject({
    method: 'POST',
    url: `/api/v1/inspirations/${inspiration.id}/reuse`,
    headers: headers(),
    payload: { requestId: randomUUID(), prompt: '长视频需要选择片段', intent: 'replicate' },
  });
  expect(response.statusCode, response.body).toBe(201);
  expect(response.json().data.draft).toMatchObject({
    referenceAssetIds: [asset.id],
    options: { trimEnd: 30, duration: 30 },
  });
  expect(response.json().data.draft.creationWarnings.join(' ')).toContain('前30秒');
});
