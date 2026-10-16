import { z } from 'zod';
import { AppError } from '../../errors';
import type { WechatGateway } from './types';
const subject = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const tokenResponse = z.object({
  access_token: z.string().min(1).max(4096),
  openid: subject,
  unionid: subject.optional(),
  scope: z.string().max(200),
});
const profileResponse = z.object({ openid: subject, unionid: subject.optional() });
export function createWechatGateway(
  config: { appId: string; appSecret: string; redirectUri: string },
  request: typeof fetch = fetch,
): WechatGateway {
  async function json(url: URL): Promise<unknown> {
    try {
      const result = await request(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      const text = await result.text();
      if (!result.ok || text.length > 65_536) throw new Error('Rejected');
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (parsed.errcode !== undefined && parsed.errcode !== 0) throw new Error('Rejected');
      return parsed;
    } catch {
      throw new AppError(502, 'WECHAT_PROTOCOL_FAILED', '微信验证暂时失败，请重新申请登录');
    }
  }
  return {
    authorize(state) {
      const url = new URL('https://open.weixin.qq.com/connect/qrconnect');
      url.search = new URLSearchParams({
        appid: config.appId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: 'snsapi_login',
        state,
      }).toString();
      url.hash = 'wechat_redirect';
      return url.href;
    },
    async exchange(code) {
      const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
      url.search = new URLSearchParams({
        appid: config.appId,
        secret: config.appSecret,
        code,
        grant_type: 'authorization_code',
      }).toString();
      const token = tokenResponse.safeParse(await json(url));
      if (!token.success || !token.data.scope.split(',').includes('snsapi_login'))
        throw new AppError(502, 'WECHAT_IDENTITY_INVALID', '微信授权结果不完整');
      const profileUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
      profileUrl.search = new URLSearchParams({
        access_token: token.data.access_token,
        openid: token.data.openid,
        lang: 'zh_CN',
      }).toString();
      const profile = profileResponse.safeParse(await json(profileUrl));
      if (
        !profile.success ||
        profile.data.openid !== token.data.openid ||
        (token.data.unionid && profile.data.unionid && token.data.unionid !== profile.data.unionid)
      )
        throw new AppError(502, 'WECHAT_IDENTITY_INVALID', '微信身份校验未通过');
      return {
        appId: config.appId,
        openid: token.data.openid,
        unionid: token.data.unionid ?? profile.data.unionid ?? null,
      };
    },
  };
}
