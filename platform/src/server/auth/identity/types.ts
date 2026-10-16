import type { Actor } from '../../../contracts/core';
export interface SmsConfig {
  enabled: boolean;
  accessKeyId?: string;
  accessKeySecret?: string;
  securityToken?: string;
  signName?: string;
  templateCode?: string;
  codeVariable?: string;
}
export interface WechatConfig {
  enabled: boolean;
  appId?: string;
  appSecret?: string;
}
export interface WechatIdentity {
  appId: string;
  openid: string;
  unionid: string | null;
}
export interface WechatGateway {
  authorize(state: string): string;
  exchange(code: string): Promise<WechatIdentity>;
}
export interface SmsGateway {
  send(input: { phone: string; code: string; requestId: string }): Promise<{
    status: 'accepted' | 'failed' | 'reconciliation_required';
    errorCode?: string;
    requestId?: string;
  }>;
}
export interface IdentitySession {
  actor: Actor;
  sessionToken: string;
}
export const IDENTITY_COOKIE = 'studio_identity_flow';
export const WECHAT_CALLBACK = '/api/v1/auth/wechat/callback';
