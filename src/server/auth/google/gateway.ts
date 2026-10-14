import { timingSafeEqual } from 'node:crypto';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { z } from 'zod';
import { AppError } from '../../errors';
import type { GoogleGateway } from './types';
const endpoints = {
  discovery: 'https://accounts.google.com/.well-known/openid-configuration',
  issuer: 'https://accounts.google.com',
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
} as const;
const discoverySchema = z.object({
  issuer: z.literal(endpoints.issuer),
  authorization_endpoint: z.literal(endpoints.authorization),
  token_endpoint: z.literal(endpoints.token),
  jwks_uri: z.literal(endpoints.jwks),
  response_types_supported: z.array(z.string()),
  id_token_signing_alg_values_supported: z.array(z.string()),
});
const keysSchema = z.object({
  keys: z
    .array(
      z
        .object({
          kty: z.literal('RSA'),
          kid: z.string().min(1).max(200),
          n: z.string().min(1),
          e: z.string().min(1),
          alg: z.literal('RS256').optional(),
          use: z.literal('sig').optional(),
        })
        .passthrough(),
    )
    .min(1)
    .max(20),
});
const claimsSchema = z.object({
  iss: z.enum([endpoints.issuer, 'accounts.google.com']),
  sub: z.string().min(1).max(255),
  email: z.string().email().max(320),
  email_verified: z.literal(true),
  nonce: z.string().min(1).max(200),
  iat: z.number().int(),
  exp: z.number().int(),
  aud: z.union([z.string(), z.array(z.string()).min(1)]),
  azp: z.string().optional(),
  name: z.string().max(200).optional(),
});
const invalid = () =>
  new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Google 身份凭据未通过验证，请重新登录');
export function createGoogleGateway(
  config: { clientId: string; clientSecret: string; redirectUri: string },
  options: { fetch?: typeof globalThis.fetch } = {},
): GoogleGateway {
  const transport = options.fetch ?? globalThis.fetch;
  let discoveryUntil = 0;
  let keys: ReturnType<typeof createLocalJWKSet> | undefined,
    keysUntil = 0;
  let keysLoading: Promise<ReturnType<typeof createLocalJWKSet>> | undefined;
  async function request(url: string, init: RequestInit = {}, limit = 100_000): Promise<unknown> {
    try {
      const response = await transport(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('HTTP response rejected');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          size += r.value.length;
          if (size > limit) throw new Error('Response too large');
          chunks.push(r.value);
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new AppError(503, 'GOOGLE_SERVICE_UNAVAILABLE', '暂时无法验证 Google 登录，请重新发起');
    }
  }
  async function discovery() {
    if (discoveryUntil > Date.now()) return;
    const result = discoverySchema.safeParse(await request(endpoints.discovery));
    if (
      !result.success ||
      !result.data.response_types_supported.includes('code') ||
      !result.data.id_token_signing_alg_values_supported.includes('RS256')
    )
      throw new AppError(503, 'GOOGLE_DISCOVERY_INVALID', 'Google 服务发现配置不符合预期');
    discoveryUntil = Date.now() + 3600_000;
  }
  async function loadKeys(force = false) {
    if (!force && keys && keysUntil > Date.now()) return keys;
    if (keysLoading) return keysLoading;
    keysLoading = (async () => {
      const result = keysSchema.safeParse(await request(endpoints.jwks, {}, 200_000));
      if (
        !result.success ||
        new Set(result.data.keys.map((k) => k.kid)).size !== result.data.keys.length ||
        result.data.keys.some((k) => 'd' in k)
      )
        throw new AppError(503, 'GOOGLE_JWKS_INVALID', 'Google 签名密钥不符合预期');
      keys = createLocalJWKSet(result.data);
      keysUntil = Date.now() + 300_000;
      return keys;
    })().finally(() => {
      keysLoading = undefined;
    });
    return keysLoading;
  }
  return {
    async authorize(input) {
      await discovery();
      const url = new URL(endpoints.authorization);
      url.search = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        scope: 'openid email profile',
        redirect_uri: config.redirectUri,
        state: input.state,
        nonce: input.nonce,
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString();
      return url.href;
    },
    async exchange(input) {
      await discovery();
      const data = z.object({ id_token: z.string().min(1).max(16384) }).safeParse(
        await request(endpoints.token, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: input.code,
            code_verifier: input.verifier,
            redirect_uri: config.redirectUri,
            client_id: config.clientId,
            client_secret: config.clientSecret,
          }).toString(),
        }),
      );
      if (!data.success) throw invalid();
      try {
        const header = decodeProtectedHeader(data.data.id_token);
        if (
          header.alg !== 'RS256' ||
          typeof header.kid !== 'string' ||
          !header.kid ||
          header.kid.length > 200 ||
          header.jku ||
          header.jwk ||
          header.x5u
        )
          throw invalid();
        const verify = async (keyset: ReturnType<typeof createLocalJWKSet>) =>
          jwtVerify(data.data.id_token, keyset, {
            algorithms: ['RS256'],
            issuer: [endpoints.issuer, 'accounts.google.com'],
            audience: config.clientId,
            clockTolerance: 30,
            maxTokenAge: 600,
          });
        let verified;
        try {
          verified = await verify(await loadKeys());
        } catch (error) {
          if (!(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ERR_JWKS_NO_MATCHING_KEY'
          ))
            throw error;
          verified = await verify(await loadKeys(true));
        }
        const claims = claimsSchema.parse(verified.payload),
          time = Math.floor(Date.now() / 1000);
        const a = Buffer.from(claims.nonce),
          b = Buffer.from(input.nonce);
        if (
          a.length !== b.length ||
          !timingSafeEqual(a, b) ||
          claims.exp <= time ||
          claims.iat > time + 30 ||
          claims.iat < Math.floor(Date.parse(input.createdAt) / 1000) - 60 ||
          claims.exp <= claims.iat ||
          (claims.azp !== undefined && claims.azp !== config.clientId) ||
          (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== config.clientId)
        )
          throw invalid();
        return {
          issuer: endpoints.issuer,
          subject: claims.sub,
          email: claims.email.trim().toLowerCase(),
          displayName: (claims.name?.trim() || claims.email.split('@')[0] || 'Google user').slice(
            0,
            80,
          ),
        };
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 503) throw error;
        throw invalid();
      }
    },
  };
}
