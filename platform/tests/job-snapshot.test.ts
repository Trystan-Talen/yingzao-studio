import { describe, expect, it } from 'vitest';
import { jobInputSchema, type JobDto } from '../src/contracts/jobs';
import { selectMatchingJobSnapshot } from '../src/web/lib/job-snapshot';

const scope = { id: 'historical-job', projectId: 'project-one', workspaceId: 'space-one' };
function job(overrides: Partial<JobDto> = {}): JobDto {
  const input = jobInputSchema.parse({ operation: 'image.generate', providerId: 'openai' });
  return {
    ...scope,
    createdBy: 'user-one',
    isArchived: false,
    downloadedAt: null,
    operation: input.operation,
    providerId: input.providerId,
    prompt: '历史作品',
    status: 'succeeded',
    stage: '结果已保存',
    requestedCredits: 1,
    settledCredits: 1,
    createdAt: '2026-10-29T12:00:00.000Z',
    updatedAt: '2026-10-29T12:01:00.000Z',
    errorMessage: null,
    input,
    outputAssets: [],
    items: [],
    ...overrides,
  };
}

describe('reopening an exact task while asynchronous reads arrive', () => {
  it('does not display the last submitted task while a different historical task loads', () => {
    const latestSubmission = job({ id: 'new-job', status: 'queued' });
    expect(selectMatchingJobSnapshot(scope, undefined, latestSubmission)).toBeUndefined();
  });

  it('keeps the accepted receipt available while that same task is still being read', () => {
    const accepted = job({ status: 'queued' });
    expect(selectMatchingJobSnapshot(scope, undefined, accepted)).toBe(accepted);
  });

  it('does not revert a completed result to an older accepted receipt', () => {
    const completed = job();
    const accepted = job({ status: 'queued', updatedAt: '2026-10-29T12:00:00.000Z' });
    expect(selectMatchingJobSnapshot(scope, completed, accepted)).toBe(completed);
  });

  it('keeps newer confirmed progress if an older in-flight read arrives afterwards', () => {
    const oldRead = job({ status: 'queued', updatedAt: '2026-10-29T12:00:00.000Z' });
    const accepted = job({ status: 'running' });
    expect(selectMatchingJobSnapshot(scope, oldRead, accepted)).toBe(accepted);
  });

  it('prefers the server result when timestamps tie', () => {
    const completed = job();
    expect(selectMatchingJobSnapshot(scope, completed, job({ status: 'queued' }))).toBe(completed);
  });

  it('rejects a task from a different project even when its identifier matches', () => {
    expect(selectMatchingJobSnapshot(scope, job({ projectId: 'other-project' }))).toBeUndefined();
  });

  it('rejects another workspace and does not select anything before scope is known', () => {
    expect(selectMatchingJobSnapshot(scope, job({ workspaceId: 'other-space' }))).toBeUndefined();
    expect(selectMatchingJobSnapshot({ ...scope, id: null }, job())).toBeUndefined();
    expect(selectMatchingJobSnapshot({ ...scope, projectId: undefined }, job())).toBeUndefined();
    expect(selectMatchingJobSnapshot({ ...scope, workspaceId: undefined }, job())).toBeUndefined();
  });

  it('can explicitly select a standalone task without treating missing scope as standalone', () => {
    const standalone = job({ projectId: null });
    expect(selectMatchingJobSnapshot({ ...scope, projectId: null }, standalone)).toBe(standalone);
  });
});
