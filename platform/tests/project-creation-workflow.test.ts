/** Isolated persistence tests. No workers or external provider requests are started. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Actor, ProjectDto } from '../src/contracts/core';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { projectDestination } from '../src/web/lib/project-navigation';

let directory: string;
let instance: Awaited<ReturnType<typeof createApp>>;
let config: AppConfig;
let actor: Actor;
let workspaceId: string;
let cookie: string;
const network = vi.fn(() => {
  throw new Error('External network forbidden');
});

beforeEach(async () => {
  vi.stubGlobal('fetch', network);
  network.mockClear();
  directory = await mkdtemp(join(tmpdir(), 'yingzao-project-workflow-create-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(directory, 'test.sqlite'),
    storageDir: join(directory, 'media'),
    sessionSecret: 'workflow-creation-fixture',
    encryptionKey: 'workflow-creation-encryption',
    isProduction: false,
    demoMode: true,
    environmentSecrets: { dify: 'isolated-quote-only-fixture' },
  };
  instance = await createApp(config, { serveWeb: false });
  const account = await instance.services.core.auth.register({
    email: 'workflow-create@example.local',
    password: 'WorkflowCreateFixture2026!',
    displayName: '项目创建测试',
  });
  workspaceId = account.workspace.id;
  cookie = `studio_session=${account.sessionToken}`;
  actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
});

afterEach(async () => {
  expect(network).not.toHaveBeenCalled();
  await instance.app.close();
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function request(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
  wid = workspaceId,
) {
  return instance.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie, origin: config.publicOrigin, 'x-workspace-id': wid },
    ...(payload ? { payload } : {}),
  });
}

async function createDetailProject() {
  const response = await request('POST', '/projects', {
    name: '不依赖名称的创作',
    kind: 'image',
    workflow: 'detail-page',
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data as ProjectDto;
}

function expectNoJobs() {
  expect(instance.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
    n: 0,
  });
}

describe('detail-page workflow recorded at project creation', () => {
  it('returns the correct route before any quote or job and persists it across reopening', async () => {
    const project = await createDetailProject();
    expect(project.workflow).toBe('detail-page');
    expect(projectDestination(project)).toBe(`/detail-pages/${project.id}`);
    const message = instance.services.db.sqlite
      .prepare('SELECT role,job_id,metadata_json FROM messages WHERE project_id=?')
      .get(project.id) as { role: string; job_id: string | null; metadata_json: string };
    expect(message).toMatchObject({ role: 'system', job_id: null });
    expect(JSON.parse(message.metadata_json)).toEqual({
      event: 'project.created',
      workflow: 'detail-page',
    });
    expectNoJobs();
    await instance.app.close();
    instance = await createApp(config, { serveWeb: false });
    const loaded = await request('GET', `/projects/${project.id}`);
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().data.workflow).toBe('detail-page');
    const listed = await request('GET', '/projects');
    expect(
      listed.json().data.items.find((item: ProjectDto) => item.id === project.id).workflow,
    ).toBe('detail-page');
    expectNoJobs();
  });

  it('keeps the route when a quote is cancelled without submitting or a later quote fails', async () => {
    const project = await createDetailProject();
    const quoted = await request('POST', '/detail-pages/plan-quote', {
      brief: '白色陶瓷杯的商品详情页',
      projectId: project.id,
    });
    expect(quoted.statusCode, quoted.body).toBe(200);
    expect(quoted.json().data.quote.id).toEqual(expect.any(String));
    // Cancelling is deliberately represented by never POSTing the quote to /jobs.
    expectNoJobs();
    const failed = await request('POST', '/detail-pages/plan-quote', {
      brief: '',
      projectId: project.id,
    });
    expect(failed.statusCode).toBe(400);
    expect((await request('GET', `/projects/${project.id}`)).json().data.workflow).toBe(
      'detail-page',
    );
    expectNoJobs();
  });

  it('preserves the marker through rename, tags, deletion and restore without letting labels classify media', async () => {
    const project = await createDetailProject();
    const core = instance.services.core;
    expect(
      core.projects.update(actor, workspaceId, project.id, {
        name: '普通名字',
        tags: ['media'],
      }).workflow,
    ).toBe('detail-page');
    core.projects.remove(actor, workspaceId, project.id);
    expect(core.projects.restore(actor, workspaceId, project.id).workflow).toBe('detail-page');
    const ordinary = core.projects.create(actor, workspaceId, {
      name: '商品详情页',
      kind: 'image',
    });
    expect(
      core.projects.update(actor, workspaceId, ordinary.id, {
        tags: ['detail-page'],
      }).workflow,
    ).toBe('media');
    expect(
      (await request('PATCH', `/projects/${ordinary.id}`, { workflow: 'detail-page' })).statusCode,
    ).toBe(400);
    expect(
      (
        await request('POST', `/projects/${ordinary.id}/messages`, {
          role: 'system',
          content: '',
          metadata: { event: 'project.created', workflow: 'detail-page' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request('POST', `/projects/${ordinary.id}/messages`, {
          role: 'user',
          content: '',
          metadata: { event: 'project.created', workflow: 'detail-page' },
        })
      ).statusCode,
    ).toBe(400);
    expect(core.projects.get(actor, workspaceId, ordinary.id).workflow).toBe('media');
  });

  it('scopes system metadata to the same project and workspace and ignores user metadata', async () => {
    const core = instance.services.core;
    const ordinary = core.projects.create(actor, workspaceId, { name: '普通项目' });
    const detail = await createDetailProject();
    const other = core.auth.createWorkspace(actor.userId, '另一空间', 'team');
    const write = instance.services.db.sqlite.prepare(
      'INSERT INTO messages(id,workspace_id,project_id,user_id,role,content,job_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    );
    for (const [wid, role] of [
      [other.id, 'system'],
      [workspaceId, 'user'],
    ])
      write.run(
        randomUUID(),
        wid,
        ordinary.id,
        actor.userId,
        role,
        '',
        null,
        JSON.stringify({ event: 'project.created', workflow: 'detail-page' }),
        new Date().toISOString(),
      );
    expect(core.projects.get(actor, workspaceId, ordinary.id).workflow).toBe('media');
    expect(core.projects.get(actor, workspaceId, detail.id).workflow).toBe('detail-page');
    expect((await request('GET', `/projects/${detail.id}`, undefined, other.id)).statusCode).toBe(
      404,
    );
    expect((await request('GET', '/projects', undefined, other.id)).json().data.items).toEqual([]);
  });

  it('rolls the project and document back if its workflow metadata cannot be committed', async () => {
    instance.services.db.sqlite.exec(`
      CREATE TEMP TRIGGER reject_workflow BEFORE INSERT ON messages
      WHEN NEW.role='system'
      BEGIN SELECT RAISE(ABORT, 'isolated workflow write failure'); END;
    `);
    const response = await request('POST', '/projects', {
      name: '事务回滚验证',
      workflow: 'detail-page',
    });
    expect(response.statusCode).toBe(500);
    for (const table of ['projects', 'documents', 'document_versions', 'messages'])
      expect(instance.services.db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({
        n: 0,
      });
  });

  it('keeps read-only members able to open the workflow but unable to create or modify it', async () => {
    const core = instance.services.core;
    const team = core.auth.createWorkspace(actor.userId, '只读权限测试', 'team');
    const project = core.projects.create(actor, team.id, {
      name: '团队详情页',
      workflow: 'detail-page',
    });
    const invite = core.team.invite(actor, team.id, {
      email: 'workflow-viewer@example.local',
      role: 'viewer',
    });
    const viewer = await core.auth.register({
      email: 'workflow-viewer@example.local',
      password: 'WorkflowViewerFixture2026!',
      displayName: '只读成员',
      inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
    });
    const readOnly = { ...actor, userId: viewer.user.id };
    expect(core.projects.get(readOnly, team.id, project.id).workflow).toBe('detail-page');
    expect(() =>
      core.projects.create(readOnly, team.id, {
        name: '不能新建',
        workflow: 'detail-page',
      }),
    ).toThrow();
    expect(() =>
      core.projects.update(readOnly, team.id, project.id, { name: '不能改名' }),
    ).toThrow();
    expect(() => core.projects.get(readOnly, workspaceId, project.id)).toThrow();
    expect(core.projects.list(actor, team.id, { page: 1, pageSize: 20 }).items).toHaveLength(1);
  });
});
