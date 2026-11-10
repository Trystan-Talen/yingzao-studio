/** Temporary SQLite fixtures only. No worker, provider, network, or runtime data. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Actor } from '../src/contracts/core';
import { createCoreServices, type CoreServices } from '../src/server/core';
import {
  closeDatabase,
  createDatabaseContext,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { projectDestination } from '../src/web/lib/project-navigation';

let directory: string;
let db: DatabaseContext;
let core: CoreServices;
let actor: Actor;
let workspaceId: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'yingzao-project-navigation-'));
  db = createDatabaseContext(join(directory, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  core = createCoreServices(db, {
    storageDir: join(directory, 'media'),
    sessionSecret: 'project-navigation-fixture',
    publicOrigin: 'http://127.0.0.1:5173',
    isProduction: false,
    demoMode: false,
  });
  const registration = await core.auth.register({
    email: 'navigation@example.local',
    password: 'NavigationFixture2026!',
    displayName: '导航测试',
  });
  workspaceId = registration.workspace.id;
  actor = {
    userId: registration.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
});

afterEach(async () => {
  closeDatabase(db);
  await rm(directory, { recursive: true, force: true });
});

function project(name = '测试项目', wid = workspaceId) {
  return core.projects.create(actor, wid, { name, kind: 'image' });
}

function jobEvidence(
  projectId: string,
  options: Record<string, unknown>,
  wid = workspaceId,
  operation = 'image.generate',
) {
  const date = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO jobs
       (id,workspace_id,user_id,project_id,operation,provider_id,prompt,input_json,input_hash,
        request_id,pricing_version,status,stage,requested_credits,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'succeeded','completed',0,?,?)`,
    )
    .run(
      randomUUID(),
      wid,
      actor.userId,
      projectId,
      operation,
      'fixture',
      '本地导航测试',
      JSON.stringify({ operation, providerId: 'fixture', prompt: '本地导航测试', options }),
      'fixture-hash',
      randomUUID(),
      'fixture-v1',
      date,
      date,
    );
}

describe('project workflow evidence and editor navigation', () => {
  it('keeps ordinary projects in the media editor regardless of their display name', () => {
    const ordinary = project('商品详情页 · 这是普通图片项目');
    jobEvidence(ordinary.id, { assistantMode: 'design-plan' }, workspaceId, 'text.assist');
    const loaded = core.projects.get(actor, workspaceId, ordinary.id);
    expect(loaded.workflow).toBe('media');
    expect(projectDestination(loaded)).toBe(`/workbench/${ordinary.id}`);
  });

  it.each([
    ['planning', 'text.assist', { assistantMode: 'detail-page' }],
    ['generation', 'image.generate', { detailPagePlan: { productName: '商品' } }],
  ])(
    'recognizes %s evidence in both project detail and list responses',
    (_, operation, options) => {
      const detail = project('未使用特殊名称');
      jobEvidence(detail.id, options, workspaceId, operation);
      const loaded = core.projects.get(actor, workspaceId, detail.id);
      const listed = core.projects.list(actor, workspaceId, { page: 1, pageSize: 20 });
      expect(loaded.workflow).toBe('detail-page');
      expect(listed.items.find((item) => item.id === detail.id)?.workflow).toBe('detail-page');
      expect(projectDestination(loaded)).toBe(`/detail-pages/${detail.id}`);
    },
  );

  it('does not treat null, string, or array options as a detail-page plan', () => {
    const ordinary = project();
    for (const detailPagePlan of [null, 'detail-page', []])
      jobEvidence(ordinary.id, { detailPagePlan });
    expect(core.projects.get(actor, workspaceId, ordinary.id).workflow).toBe('media');
  });

  it('does not borrow evidence from another project in the same workspace', () => {
    const ordinary = project('普通创作');
    const detail = project('详情创作');
    jobEvidence(detail.id, { assistantMode: 'detail-page' });
    expect(core.projects.get(actor, workspaceId, ordinary.id).workflow).toBe('media');
    expect(core.projects.get(actor, workspaceId, detail.id).workflow).toBe('detail-page');
  });

  it('scopes evidence by workspace even if a legacy job has a mismatched project reference', () => {
    const ordinary = project();
    const otherSpace = core.auth.createWorkspace(actor.userId, '另一测试空间', 'team');
    // A deliberately inconsistent historical fixture: both foreign keys exist,
    // but the job's workspace differs from the project's workspace.
    jobEvidence(ordinary.id, { assistantMode: 'detail-page' }, otherSpace.id);
    expect(core.projects.get(actor, workspaceId, ordinary.id).workflow).toBe('media');
    expect(() => core.projects.get(actor, otherSpace.id, ordinary.id)).toThrow();
    expect(core.projects.list(actor, otherSpace.id, { page: 1, pageSize: 20 }).items).toEqual([]);
  });

  it('does not expose workflow or project data to another workspace member', async () => {
    const detail = project();
    jobEvidence(detail.id, { assistantMode: 'detail-page' });
    const otherSpace = core.auth.createWorkspace(actor.userId, '另一测试团队', 'team');
    const invitation = core.team.invite(actor, otherSpace.id, {
      email: 'outsider@example.local',
      role: 'viewer',
    });
    const outsider = await core.auth.register({
      email: 'outsider@example.local',
      password: 'OutsiderFixture2026!',
      displayName: '其他用户',
      inviteToken: new URL(invitation.inviteUrl).hash.slice('#token='.length),
    });
    const otherActor: Actor = { ...actor, userId: outsider.user.id };
    expect(() => core.projects.get(otherActor, workspaceId, detail.id)).toThrow();
    expect(() => core.projects.list(otherActor, workspaceId, { page: 1, pageSize: 20 })).toThrow();
    expect(
      core.projects.list(otherActor, outsider.workspace.id, { page: 1, pageSize: 20 }).items,
    ).toEqual([]);
  });

  it('uses the existing media route for responses that predate the workflow field', () => {
    expect(projectDestination({ id: 'legacy-project' })).toBe('/workbench/legacy-project');
  });
});
