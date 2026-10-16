import { describe, expect, it, vi } from 'vitest';
import { createWechatGateway } from '../src/server/auth/identity/wechat';
import { AppError } from '../src/server/errors';

const config = {
  appId: 'test-website-app',
  appSecret: 'sensitive-test-app-secret',
  redirectUri: 'https://studio.example.test/api/v1/auth/wechat/callback',
};
const authorizationCode = 'sensitive-test-authorization-code';
const accessToken = 'sensitive-test-access-token';
const openid = 'test-app-openid';
const unionid = 'test-platform-unionid';
const token = {
  access_token: accessToken,
  expires_in: 7200,
  refresh_token: 'sensitive-test-refresh-token',
  openid,
  unionid,
  scope: 'snsapi_login',
};
const profile = { openid, unionid };
const privateText = `${config.appSecret} ${authorizationCode} ${accessToken}`;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function mockGateway(...responses: Response[]) {
  const request = vi.fn<typeof fetch>();
  for (const result of responses) request.mockResolvedValueOnce(result);
  request.mockRejectedValue(new Error('Unexpected additional request'));
  return { request, gateway: createWechatGateway(config, request) };
}
async function privateFailure(
  result: Promise<unknown>,
  code: 'WECHAT_PROTOCOL_FAILED' | 'WECHAT_IDENTITY_INVALID',
) {
  const error: unknown = await result.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  const failure = error as AppError;
  expect(failure.statusCode).toBe(502);
  expect(failure.code).toBe(code);
  expect(failure.details).toBeUndefined();
  const exposed = JSON.stringify({
    name: failure.name,
    code: failure.code,
    message: failure.message,
    details: failure.details,
    stack: failure.stack,
  });
  for (const secret of [
    config.appSecret,
    authorizationCode,
    accessToken,
    'sensitive-test-refresh-token',
  ]) {
    expect(exposed).not.toContain(secret);
  }
}

describe('WeChat website login gateway contract', () => {
  it('builds the official qrconnect authorization URL with an exact encoded state and callback', () => {
    const { gateway, request } = mockGateway();
    const state = 'opaque+state/=汉字?&redirect=https://other.example.test';
    const address = gateway.authorize(state);
    const url = new URL(address);
    expect(url.origin).toBe('https://open.weixin.qq.com');
    expect(url.pathname).toBe('/connect/qrconnect');
    expect(url.hash).toBe('#wechat_redirect');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appid: config.appId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'snsapi_login',
      state,
    });
    expect(url.searchParams.getAll('state')).toEqual([state]);
    expect(address).not.toContain(config.appSecret);
    expect(address).not.toContain(authorizationCode);
    expect(address).not.toContain(accessToken);
    expect(request).not.toHaveBeenCalled();
  });

  it('exchanges only through the two fixed HTTPS endpoints with credentials confined to server requests', async () => {
    const { gateway, request } = mockGateway(
      json({ ...token, redirect_uri: 'https://untrusted.example.test' }),
      json({
        ...profile,
        nickname: 'Untrusted display name',
        email: 'unverified@example.test',
        headimgurl: 'https://untrusted.example.test/avatar',
        access_token: accessToken,
      }),
    );
    const identity = await gateway.exchange(authorizationCode);
    expect(identity).toEqual({ appId: config.appId, openid, unionid });
    expect(request).toHaveBeenCalledTimes(2);
    const [tokenAddress, tokenOptions] = request.mock.calls[0]!;
    const tokenUrl = new URL(String(tokenAddress));
    expect(tokenUrl.origin).toBe('https://api.weixin.qq.com');
    expect(tokenUrl.pathname).toBe('/sns/oauth2/access_token');
    expect(Object.fromEntries(tokenUrl.searchParams)).toEqual({
      appid: config.appId,
      secret: config.appSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    });
    const [profileAddress, profileOptions] = request.mock.calls[1]!;
    const profileUrl = new URL(String(profileAddress));
    expect(profileUrl.origin).toBe('https://api.weixin.qq.com');
    expect(profileUrl.pathname).toBe('/sns/userinfo');
    expect(Object.fromEntries(profileUrl.searchParams)).toEqual({
      access_token: accessToken,
      openid,
      lang: 'zh_CN',
    });
    expect(String(profileAddress)).not.toContain(config.appSecret);
    expect(String(profileAddress)).not.toContain(authorizationCode);
    for (const options of [tokenOptions, profileOptions]) {
      expect(options?.method ?? 'GET').toBe('GET');
      expect(options?.redirect).toBe('error');
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options?.signal?.aborted).toBe(false);
      expect(options?.body).toBeUndefined();
    }
    expect(tokenOptions?.signal).not.toBe(profileOptions?.signal);
    expect(JSON.stringify(identity)).not.toContain(accessToken);
    expect(JSON.stringify(identity)).not.toContain('unverified@example.test');
  });

  it('encodes provider credentials and authorization codes as single query values', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(token))
      .mockResolvedValueOnce(json(profile));
    const secret = 'sensitive+secret/=&汉字';
    const code = 'sensitive+code/=&汉字';
    await createWechatGateway({ ...config, appSecret: secret }, request).exchange(code);
    const address = new URL(String(request.mock.calls[0]![0]));
    expect(address.searchParams.getAll('secret')).toEqual([secret]);
    expect(address.searchParams.getAll('code')).toEqual([code]);
    expect([...address.searchParams.keys()]).toEqual(['appid', 'secret', 'code', 'grant_type']);
  });

  it.each([
    [{ ...token, unionid: undefined }, profile, unionid],
    [token, { openid }, unionid],
    [{ ...token, unionid: undefined }, { openid }, null],
  ])(
    'allows an optional unionid while preserving the verified app-local identity: %j',
    async (tokenValue, profileValue, expectedUnionid) => {
      const { gateway } = mockGateway(json(tokenValue), json(profileValue));
      expect(await gateway.exchange(authorizationCode)).toEqual({
        appId: config.appId,
        openid,
        unionid: expectedUnionid,
      });
    },
  );

  it('accepts a granted snsapi_login scope among comma-delimited scopes', async () => {
    const { gateway } = mockGateway(
      json({ ...token, scope: 'other_scope,snsapi_login' }),
      json(profile),
    );
    expect(await gateway.exchange(authorizationCode)).toEqual({
      appId: config.appId,
      openid,
      unionid,
    });
  });

  it.each([undefined, '', 'snsapi_userinfo', 'snsapi_login_extra', 'SNSAPI_LOGIN', 1])(
    'rejects missing or nonmatching website-login scope before requesting a profile: %j',
    async (scope) => {
      const { gateway, request } = mockGateway(json({ ...token, scope }), json(profile));
      await privateFailure(gateway.exchange(authorizationCode), 'WECHAT_IDENTITY_INVALID');
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { access_token: undefined },
    { access_token: '' },
    { access_token: 'x'.repeat(4097) },
    { openid: undefined },
    { openid: '' },
    { openid: 'unsafe/id' },
    { openid: 'x'.repeat(129) },
    { unionid: null },
  ])(
    'rejects incomplete or malformed token identities before the profile call: %j',
    async (changes) => {
      const { gateway, request } = mockGateway(json({ ...token, ...changes }), json(profile));
      await privateFailure(gateway.exchange(authorizationCode), 'WECHAT_IDENTITY_INVALID');
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { openid: 'another-openid', unionid },
    { openid, unionid: 'another-unionid' },
    { unionid },
    { openid: '', unionid },
    { openid, unionid: 'unsafe/id' },
  ])('rejects inconsistent or malformed profile identities: %j', async (value) => {
    const { gateway, request } = mockGateway(json(token), json(value));
    await privateFailure(gateway.exchange(authorizationCode), 'WECHAT_IDENTITY_INVALID');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(['token', 'profile'] as const)(
    'rejects a provider errcode at the %s step without exposing errmsg',
    async (step) => {
      const rejected = json({ errcode: 40029, errmsg: privateText });
      const { gateway, request } =
        step === 'token' ? mockGateway(rejected) : mockGateway(json(token), rejected);
      await privateFailure(gateway.exchange(authorizationCode), 'WECHAT_PROTOCOL_FAILED');
      expect(request).toHaveBeenCalledTimes(step === 'token' ? 1 : 2);
    },
  );

  it('accepts numeric zero errcode only when the actual identity fields remain complete', async () => {
    const { gateway } = mockGateway(
      json({ ...token, errcode: 0 }),
      json({ ...profile, errcode: 0 }),
    );
    expect(await gateway.exchange(authorizationCode)).toEqual({
      appId: config.appId,
      openid,
      unionid,
    });
  });

  it.each([400, 401, 403, 429, 500, 503])(
    'rejects token HTTP %s without retrying a one-time authorization code',
    async (status) => {
      const { gateway, request } = mockGateway(
        json({ ...token, errmsg: privateText }, status),
        json(profile),
      );
      await privateFailure(gateway.exchange(authorizationCode), 'WECHAT_PROTOCOL_FAILED');
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 500, 503])(
    'rejects profile HTTP %s without returning the token identity',
    async (status) => {
      const { gateway, request } = mockGateway(
        json(token),
        json({ ...profile, errmsg: privateText }, status),
      );
      await privateFailure(gateway.exchange(authorizationCode), 'WECHAT_PROTOCOL_FAILED');
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['token', 'profile'] as const)(
    'rejects a redirect response at the %s step and disables redirect following',
    async (step) => {
      const redirect = new Response(privateText, {
        status: 302,
        headers: { location: 'https://untrusted.example.test' },
      });
      const { gateway, request } =
        step === 'token' ? mockGateway(redirect) : mockGateway(json(token), redirect);
      await privateFailure(gateway.exchange(authorizationCode), 'WECHAT_PROTOCOL_FAILED');
      expect(request).toHaveBeenCalledTimes(step === 'token' ? 1 : 2);
      expect(request.mock.calls.at(-1)![1]?.redirect).toBe('error');
    },
  );

  it.each(['token', 'profile'] as const)(
    'handles a timeout at the %s step without retrying or exposing the exception',
    async (step) => {
      const request = vi.fn<typeof fetch>();
      if (step === 'profile') request.mockResolvedValueOnce(json(token));
      request.mockRejectedValueOnce(new DOMException(privateText, 'TimeoutError'));
      await privateFailure(
        createWechatGateway(config, request).exchange(authorizationCode),
        'WECHAT_PROTOCOL_FAILED',
      );
      expect(request).toHaveBeenCalledTimes(step === 'token' ? 1 : 2);
      expect(request.mock.calls.at(-1)![1]?.signal).toBeInstanceOf(AbortSignal);
    },
  );

  it.each(['token', 'profile'] as const)(
    'handles a disconnected %s request without exposing its sensitive URL',
    async (step) => {
      const request = vi.fn<typeof fetch>();
      if (step === 'profile') request.mockResolvedValueOnce(json(token));
      request.mockRejectedValueOnce(new Error(`https://api.weixin.qq.com/?private=${privateText}`));
      await privateFailure(
        createWechatGateway(config, request).exchange(authorizationCode),
        'WECHAT_PROTOCOL_FAILED',
      );
      expect(request).toHaveBeenCalledTimes(step === 'token' ? 1 : 2);
    },
  );

  it.each(['token', 'profile'] as const)(
    'rejects non-JSON %s responses without exposing their content',
    async (step) => {
      const rejected = new Response(`<html>${privateText}</html>`);
      const { gateway, request } =
        step === 'token' ? mockGateway(rejected) : mockGateway(json(token), rejected);
      await privateFailure(gateway.exchange(authorizationCode), 'WECHAT_PROTOCOL_FAILED');
      expect(request).toHaveBeenCalledTimes(step === 'token' ? 1 : 2);
    },
  );

  it.each(['token', 'profile'] as const)(
    'rejects oversized %s responses without returning an identity',
    async (step) => {
      const rejected = json({
        ...(step === 'token' ? token : profile),
        message: 'x'.repeat(65_537),
      });
      const { gateway } =
        step === 'token' ? mockGateway(rejected) : mockGateway(json(token), rejected);
      await privateFailure(gateway.exchange(authorizationCode), 'WECHAT_PROTOCOL_FAILED');
    },
  );

  it.each([null, [], 'not-an-object'])(
    'rejects invalid JSON response shapes without leaking raw content: %j',
    async (value) => {
      const { gateway, request } = mockGateway(json(value));
      const expected = value === null ? 'WECHAT_PROTOCOL_FAILED' : 'WECHAT_IDENTITY_INVALID';
      await privateFailure(gateway.exchange(authorizationCode), expected);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a response-body read failure without exposing its exception', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error(privateText));
      },
    });
    const { gateway, request } = mockGateway(new Response(body));
    await privateFailure(gateway.exchange(authorizationCode), 'WECHAT_PROTOCOL_FAILED');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
