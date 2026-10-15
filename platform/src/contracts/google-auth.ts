import { z } from 'zod';
export const GoogleStartInputSchema = z
  .object({
    inviteToken: z.string().min(24).max(200).optional(),
    referralCode: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
  })
  .strict();
export const GooglePasswordInputSchema = z
  .object({ password: z.string().min(1).max(128) })
  .strict();
export const GoogleCallbackInputSchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code: z.string().min(1).max(4096).optional(),
    error: z.string().min(1).max(200).optional(),
  })
  .refine((v) => !!v.code !== !!v.error, { message: '必须有授权码或明确拒绝状态' });
export const GoogleStatusSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  available: z.boolean(),
  linked: z.boolean(),
  hasLocalPassword: z.boolean(),
  identity: z.object({ email: z.string().email(), linkedAt: z.string().datetime() }).nullable(),
});
export type GoogleStatusDto = z.infer<typeof GoogleStatusSchema>;
export const GoogleBeginSchema = z.object({
  authorizationUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});
