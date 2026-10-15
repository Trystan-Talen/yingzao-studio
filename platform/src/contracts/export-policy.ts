import { z } from 'zod';

export const ExportWatermarkConfigSchema = z
  .object({
    mode: z.enum(['off', 'all', 'non-subscribers']).default('off'),
    text: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .default('映造 Studio'),
    opacity: z.number().min(0.1).max(1).default(0.28),
  })
  .strict();
export type ExportWatermarkConfig = z.infer<typeof ExportWatermarkConfigSchema>;
const watermarkSchema = z
  .object({
    text: ExportWatermarkConfigSchema.shape.text.removeDefault(),
    opacity: ExportWatermarkConfigSchema.shape.opacity.removeDefault(),
  })
  .strict();
export const ExportPolicySchema = z
  .object({
    version: z.literal('yingzao-export-policy/v1'),
    workspaceId: z.string().uuid(),
    evaluatedAt: z.iso.datetime(),
    scope: z.literal('application-exports'),
    mode: z.enum(['off', 'all', 'non-subscribers']),
    reason: z.enum(['disabled', 'demo-exempt', 'subscription-exempt', 'required']),
    watermark: watermarkSchema.nullable(),
  })
  .strict()
  .superRefine((policy, context) => {
    if ((policy.reason === 'required') !== (policy.watermark !== null))
      context.addIssue({ code: 'custom', message: 'Watermark and policy reason do not match' });
    if ((policy.mode === 'off') !== (policy.reason === 'disabled'))
      context.addIssue({ code: 'custom', message: 'Disabled policy must have mode off' });
    if (policy.reason === 'subscription-exempt' && policy.mode !== 'non-subscribers')
      context.addIssue({
        code: 'custom',
        message: 'Subscription exemption requires non-subscriber mode',
      });
  });
export type ExportPolicy = z.infer<typeof ExportPolicySchema>;
/** Resolve on the server from current workspace entitlements, never from client membership claims. */
export function resolveExportPolicy(input: {
  workspaceId: string;
  isDemo: boolean;
  hasActiveSubscription: boolean;
  config?: Partial<ExportWatermarkConfig>;
  evaluatedAt?: string;
}): ExportPolicy {
  const config = ExportWatermarkConfigSchema.parse(input.config ?? {});
  const reason =
    config.mode === 'off'
      ? 'disabled'
      : input.isDemo
        ? 'demo-exempt'
        : config.mode === 'non-subscribers' && input.hasActiveSubscription
          ? 'subscription-exempt'
          : 'required';
  return ExportPolicySchema.parse({
    version: 'yingzao-export-policy/v1',
    workspaceId: input.workspaceId,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    scope: 'application-exports',
    mode: config.mode,
    reason,
    watermark: reason === 'required' ? { text: config.text, opacity: config.opacity } : null,
  });
}
