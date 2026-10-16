import { z } from 'zod';

const publicHttpsUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }, '联系渠道必须使用不含账户凭据的 HTTPS 地址');
export const supportChannelsSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .regex(/^\+?\d[\d\s().-]{4,38}$/)
      .nullable()
      .default(null),
    hours: z.string().trim().min(1).max(160).nullable().default(null),
    wechatQrUrl: publicHttpsUrl.nullable().default(null),
    feedbackUrl: publicHttpsUrl.nullable().default(null),
    guideUrl: publicHttpsUrl.nullable().default(null),
  })
  .strict();
export type SupportChannelsDto = z.infer<typeof supportChannelsSchema>;
