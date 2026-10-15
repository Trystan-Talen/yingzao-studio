import type { Actor } from '../../../contracts/core';
export interface GoogleConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
}
export interface GoogleServiceConfig {
  publicOrigin: string;
  encryptionKey: string;
  isProduction: boolean;
  google?: GoogleConfig;
}
export interface GoogleIdentity {
  issuer: 'https://accounts.google.com';
  subject: string;
  email: string;
  displayName: string;
}
export interface GoogleGateway {
  authorize(input: { state: string; nonce: string; codeChallenge: string }): Promise<string>;
  exchange(input: {
    code: string;
    verifier: string;
    nonce: string;
    createdAt: string;
  }): Promise<GoogleIdentity>;
}
export interface GoogleSessionContext {
  actor: Actor;
  sessionToken: string;
}
export const GOOGLE_CALLBACK_PATH = '/api/v1/auth/google/callback';
export const GOOGLE_FLOW_COOKIE = 'studio_google_flow';
