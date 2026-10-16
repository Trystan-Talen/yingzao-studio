import { supportChannelsSchema } from '../contracts/support';

export function readSupportConfig(env: NodeJS.ProcessEnv) {
  const value = (key: string) => env[key]?.trim() || null;
  return supportChannelsSchema.parse({
    phone: value('SUPPORT_PHONE'),
    hours: value('SUPPORT_HOURS'),
    wechatQrUrl: value('SUPPORT_WECHAT_QR_URL'),
    feedbackUrl: value('SUPPORT_FEEDBACK_URL'),
    guideUrl: value('SUPPORT_GUIDE_URL'),
  });
}
