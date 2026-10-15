import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ExportPolicySchema, resolveExportPolicy } from '../src/contracts/export-policy';
import { exportPolicyManifest } from '../src/web/editor/export-watermark';
const wid = randomUUID();
it('keeps default and demo exports unwatermarked while exposing the explicit rule', () => {
  expect(
    resolveExportPolicy({ workspaceId: wid, isDemo: false, hasActiveSubscription: false }),
  ).toMatchObject({ mode: 'off', reason: 'disabled', watermark: null });
  for (const mode of ['all', 'non-subscribers'] as const)
    expect(
      resolveExportPolicy({
        workspaceId: wid,
        isDemo: true,
        hasActiveSubscription: false,
        config: { mode },
      }),
    ).toMatchObject({ reason: 'demo-exempt', watermark: null });
});
it('distinguishes active membership exemption from expired membership and all-workspace policy', () => {
  const input = {
    workspaceId: wid,
    isDemo: false,
    hasActiveSubscription: true,
    config: { mode: 'non-subscribers' as const, text: 'Brand', opacity: 0.5 },
  };
  expect(resolveExportPolicy(input)).toMatchObject({
    reason: 'subscription-exempt',
    watermark: null,
  });
  expect(resolveExportPolicy({ ...input, hasActiveSubscription: false })).toMatchObject({
    reason: 'required',
    watermark: { text: 'Brand', opacity: 0.5 },
  });
  expect(resolveExportPolicy({ ...input, config: { mode: 'all' } })).toMatchObject({
    reason: 'required',
    watermark: { text: '映造 Studio', opacity: 0.28 },
  });
});
it('rejects misleading or invalid policies and serializes truthful sidecar enforcement scope', () => {
  const policy = resolveExportPolicy({
    workspaceId: wid,
    isDemo: false,
    hasActiveSubscription: false,
    config: { mode: 'all' },
  });
  for (const malformed of [
    { ...policy, watermark: null },
    { ...policy, reason: 'subscription-exempt' },
    { ...policy, mode: 'off' },
    { ...policy, watermark: { text: '', opacity: 1 } },
    { ...policy, watermark: { text: 'invisible', opacity: 0 } },
  ])
    expect(ExportPolicySchema.safeParse(malformed).success).toBe(false);
  expect(exportPolicyManifest(policy)).toMatchObject({
    workspaceId: wid,
    applied: true,
    scope: 'application-exports',
  });
  expect(exportPolicyManifest().status).toBe('no-server-policy-provided');
  expect(exportPolicyManifest().enforcement).toContain('originals');
});
