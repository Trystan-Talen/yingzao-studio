import { z } from 'zod';
import { RegisterInputSchema } from './core';
export const IdentityPasswordSchema = z.object({ password: z.string().min(1).max(128) }).strict();
const phone = z
  .string()
  .trim()
  .regex(/^(?:\+86|0086)?1[3-9]\d{9}$/, '请输入中国大陆手机号码');
export const SmsSendSchema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('login'), phone }).strict(),
  z.object({ purpose: z.literal('bind'), phone, password: z.string().min(1).max(128) }).strict(),
  z.object({ purpose: z.literal('change-old'), password: z.string().min(1).max(128) }).strict(),
  z.object({ purpose: z.literal('change-new'), phone, oldChallengeId: z.string().uuid() }).strict(),
]);
export const SmsVerifySchema = z
  .object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict();
export const IdentityRegistrationSchema = RegisterInputSchema.extend({
  registrationId: z.string().uuid(),
  confirmPassword: z.string().min(12).max(128),
})
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  });
export interface IdentityStatus {
  sms: { enabled: boolean; ready: boolean; reason: string | null };
  wechat: { enabled: boolean; ready: boolean; reason: string | null };
  phone?: { masked: string; verifiedAt: string } | null;
  wechatLinked?: boolean;
  hasLocalPassword?: boolean;
  emailVerified?: boolean;
}
export interface IdentityResult {
  authenticated?: true;
  linked?: true;
  verified?: true;
  challengeId?: string;
  registrationId?: string;
}
