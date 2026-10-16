import { z } from 'zod';

export const PasswordRecoveryStatusSchema = z.object({
  enabled: z.boolean(),
  disabledReason: z.enum(['disabled', 'smtp-disabled']).nullable(),
  hasLocalPassword: z.boolean().optional(),
  canSetLocalPassword: z.boolean().optional(),
  deliveryEmail: z.string().optional(),
});
export type PasswordRecoveryStatus = z.infer<typeof PasswordRecoveryStatusSchema>;
export const PasswordForgotInputSchema = z
  .object({ email: z.string().trim().email().max(254) })
  .strict();
export const PasswordSetupInputSchema = z.object({}).strict();
export const PasswordCompleteInputSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    newPassword: z.string().min(12).max(128),
    confirmPassword: z.string().min(12).max(128),
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: '两次输入的密码不一致',
  });
export const PasswordRequestResultSchema = z.object({ accepted: z.literal(true) });
export const PasswordCompleteResultSchema = z.object({ changed: z.literal(true) });
