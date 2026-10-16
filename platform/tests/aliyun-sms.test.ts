import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAliyunSmsGateway, signAliyunRequest } from '../src/server/auth/identity/aliyun';
import type { SmsConfig } from '../src/server/auth/identity/types';

const config: SmsConfig = {
  enabled: true,
  accessKeyId: 'TestAccessKeyId',
  accessKeySecret: 'TestAccessKeySecret',
  signName: "营造 测试!*'()~",
  templateCode: 'SMS_123456',
};
const input = {
  phone: '+8613800138000',
  code: '014293',
  requestId: 'delivery-123',
};
const providerRequestId = 'F655A8D5-B967-440B-8683-DAD6FF8DE990';
const instant = new Date('2023-10-26T10:22:32.678Z');
const nonce = '3156853299f313e23d1673dc12e1703d';
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function gateway(result: Response, settings: SmsConfig = config) {
  const request = vi.fn<typeof fetch>().mockResolvedValue(result);
  return {
    request,
    sender: createAliyunSmsGateway(settings, {
      request,
      now: () => instant,
      nonce: () => nonce,
    }),
  };
}

describe('Aliyun ACS3 SMS protocol', () => {
  it('matches the official ACS3-HMAC-SHA256 fixed signature vector', () => {
    const signed = signAliyunRequest({
      method: 'POST',
      pathname: '/',
      query: {
        RegionId: 'cn-shanghai',
        ImageId: 'win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd',
      },
      headers: {
        host: 'ecs.cn-shanghai.aliyuncs.com',
        'x-acs-action': 'RunInstances',
        'x-acs-version': '2014-05-26',
        'x-acs-date': '2023-10-26T10:22:32Z',
        'x-acs-signature-nonce': nonce,
      },
      accessKeyId: 'YourAccessKeyId',
      accessKeySecret: 'YourAccessKeySecret',
    });
    expect(signed.query).toBe(
      'ImageId=win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd&RegionId=cn-shanghai',
    );
    expect(signed.headers.authorization).toBe(
      'ACS3-HMAC-SHA256 Credential=YourAccessKeyId,SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0',
    );
  });

  it('signs lower-case trimmed required headers, content type, all x-acs headers and body hash', () => {
    const signed = signAliyunRequest({
      method: 'post',
      pathname: '/a b/!*',
      query: { z: "!*'()~ +", A: '中文' },
      headers: {
        Host: ' example.test ',
        'Content-Type': ' application/json ',
        'X-Acs-Security-Token': ' test-sts ',
        'X-Acs-Version': '2023-01-01',
        accept: 'application/json',
      },
      body: '{"a":1}',
      accessKeyId: 'test',
      accessKeySecret: 'test-secret',
    });
    expect(signed.query).toBe('A=%E4%B8%AD%E6%96%87&z=%21%2A%27%28%29~%20%2B');
    expect(signed.headers.host).toBe('example.test');
    expect(signed.headers['content-type']).toBe('application/json');
    expect(signed.headers['x-acs-content-sha256']).toBe(
      createHash('sha256').update('{"a":1}').digest('hex'),
    );
    expect(signed.headers.authorization).toContain(
      'SignedHeaders=content-type;host;x-acs-content-sha256;x-acs-security-token;x-acs-version,',
    );
    expect(signed.headers.authorization).not.toContain('accept;');
  });

  it('sends one canonical SendSms POST to the fixed host without sensitive body or credentials in query', async () => {
    const { request, sender } = gateway(response({ Code: 'OK', RequestId: providerRequestId }));
    expect(await sender.send(input)).toEqual({ status: 'accepted', requestId: providerRequestId });
    expect(request).toHaveBeenCalledTimes(1);
    const [address, options] = request.mock.calls[0]!;
    const url = new URL(String(address));
    expect(url.origin).toBe('https://dysmsapi.aliyuncs.com');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('PhoneNumbers')).toBe('13800138000');
    expect(url.searchParams.get('SignName')).toBe(config.signName);
    expect(url.searchParams.get('TemplateCode')).toBe(config.templateCode);
    expect(url.searchParams.get('OutId')).toBe(input.requestId);
    expect(JSON.parse(url.searchParams.get('TemplateParam')!)).toEqual({ code: input.code });
    expect([...url.searchParams.keys()]).toEqual([
      'OutId',
      'PhoneNumbers',
      'SignName',
      'TemplateCode',
      'TemplateParam',
    ]);
    expect(url.search).toContain('%20');
    expect(url.search).toContain('%21%2A%27%28%29~');
    expect(url.search).not.toContain('+');
    expect(String(address)).not.toContain(config.accessKeyId);
    expect(String(address)).not.toContain(config.accessKeySecret);
    expect(options?.method).toBe('POST');
    expect(options?.body).toBe('');
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(options?.headers);
    expect(headers.get('host')).toBe(url.host);
    expect(headers.get('x-acs-action')).toBe('SendSms');
    expect(headers.get('x-acs-version')).toBe('2017-05-25');
    expect(headers.get('x-acs-date')).toBe('2023-10-26T10:22:32Z');
    expect(headers.get('x-acs-signature-nonce')).toBe(nonce);
    expect(headers.get('x-acs-content-sha256')).toBe(emptyHash);
    expect(headers.get('content-type')).toBeNull();
    expect(headers.get('authorization')).toMatch(
      /^ACS3-HMAC-SHA256 Credential=TestAccessKeyId,SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=[a-f0-9]{64}$/,
    );
  });

  it('signs the optional STS token and only the configured template variable', async () => {
    const { request, sender } = gateway(response({ Code: 'OK' }), {
      ...config,
      securityToken: 'test-sts/+token=',
      codeVariable: 'verification_code',
    });
    expect(await sender.send(input)).toEqual({ status: 'accepted' });
    const [address, options] = request.mock.calls[0]!;
    const headers = new Headers(options?.headers);
    expect(headers.get('x-acs-security-token')).toBe('test-sts/+token=');
    expect(headers.get('authorization')).toContain(
      'x-acs-date;x-acs-security-token;x-acs-signature-nonce;x-acs-version,',
    );
    const url = new URL(String(address));
    expect(JSON.parse(url.searchParams.get('TemplateParam')!)).toEqual({
      verification_code: input.code,
    });
    expect(String(address)).not.toContain('test-sts');
  });

  it('uses a new clock and nonce for each separate send without retrying a send', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => response({ Code: 'OK' }));
    const now = vi
      .fn()
      .mockReturnValueOnce(instant)
      .mockReturnValueOnce(new Date('2023-10-26T10:23:33Z'));
    const nextNonce = vi.fn().mockReturnValueOnce('nonce-one').mockReturnValueOnce('nonce-two');
    const sender = createAliyunSmsGateway(config, { request, now, nonce: nextNonce });
    await sender.send(input);
    await sender.send({ ...input, requestId: 'another-delivery' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(new Headers(request.mock.calls[0]![1]?.headers).get('x-acs-signature-nonce')).toBe(
      'nonce-one',
    );
    expect(new Headers(request.mock.calls[1]![1]?.headers).get('x-acs-signature-nonce')).toBe(
      'nonce-two',
    );
    expect(new Headers(request.mock.calls[1]![1]?.headers).get('x-acs-date')).toBe(
      '2023-10-26T10:23:33Z',
    );
  });

  it('treats an explicit business rejection as failed without exposing provider descriptions', async () => {
    const { sender } = gateway(
      response({
        Code: 'isv.BUSINESS_LIMIT_CONTROL',
        Message: `private ${input.phone} ${input.code} ${config.accessKeySecret}`,
        RequestId: providerRequestId,
      }),
    );
    expect(await sender.send(input)).toEqual({
      status: 'failed',
      errorCode: 'ALIYUN_SMS_REJECTED',
      requestId: providerRequestId,
    });
  });

  it.each([400, 401, 403, 429])(
    'treats HTTP %s as a definite rejection with no response contents',
    async (status) => {
      const { request, sender } = gateway(
        new Response(`private ${input.phone} ${input.code}`, { status }),
      );
      expect(await sender.send(input)).toEqual({
        status: 'failed',
        errorCode: 'ALIYUN_SMS_REJECTED',
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([500, 502, 503, 504])(
    'does not retry HTTP %s because acceptance is uncertain',
    async (status) => {
      const { request, sender } = gateway(response({ Code: 'OK' }, status));
      expect(await sender.send(input)).toEqual({
        status: 'reconciliation_required',
        errorCode: 'ALIYUN_SMS_UNCERTAIN',
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('does not follow redirects or interpret a redirected OK as accepted', async () => {
    const { request, sender } = gateway(response({ Code: 'OK' }, 307));
    expect(await sender.send(input)).toEqual({
      status: 'reconciliation_required',
      errorCode: 'ALIYUN_SMS_UNCERTAIN',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not retry a dropped connection or expose its exception', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error(
          `https://dysmsapi.aliyuncs.com/?phone=${input.phone}&code=${input.code}&secret=${config.accessKeySecret}`,
        ),
      );
    const sender = createAliyunSmsGateway(config, { request });
    expect(await sender.send(input)).toEqual({
      status: 'reconciliation_required',
      errorCode: 'ALIYUN_SMS_UNCERTAIN',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not expose non-JSON response contents', async () => {
    const { sender } = gateway(
      new Response(`<html>${input.phone} ${input.code} ${config.accessKeySecret}</html>`),
    );
    expect(await sender.send(input)).toEqual({
      status: 'reconciliation_required',
      errorCode: 'ALIYUN_SMS_UNCERTAIN',
    });
  });

  it.each([null, [], {}, { Code: 0 }, { Code: '' }])(
    'requires a complete object response before deciding: %j',
    async (value) => {
      const { sender } = gateway(response(value));
      expect(await sender.send(input)).toEqual({
        status: 'reconciliation_required',
        errorCode: 'ALIYUN_SMS_UNCERTAIN',
      });
    },
  );

  it('does not copy a phone, code or URL masquerading as provider identifiers', async () => {
    const { sender } = gateway(
      response({ Code: input.phone, RequestId: input.code, Message: 'private' }),
    );
    expect(await sender.send(input)).toEqual({
      status: 'failed',
      errorCode: 'ALIYUN_SMS_REJECTED',
    });
  });

  it('classifies a response-body read failure as uncertain', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error('private response'));
      },
    });
    const { sender } = gateway(new Response(body));
    expect(await sender.send(input)).toEqual({
      status: 'reconciliation_required',
      errorCode: 'ALIYUN_SMS_UNCERTAIN',
    });
  });

  it('rejects oversized response payloads without exposing them', async () => {
    const { sender } = gateway(response({ Code: 'OK', Message: 'x'.repeat(65_537) }));
    expect(await sender.send(input)).toEqual({
      status: 'reconciliation_required',
      errorCode: 'ALIYUN_SMS_UNCERTAIN',
    });
  });

  it('never requests when disabled', async () => {
    const { sender, request } = gateway(response({ Code: 'OK' }), { ...config, enabled: false });
    expect(await sender.send(input)).toEqual({ status: 'failed', errorCode: 'SMS_DISABLED' });
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['accessKeyId', 'accessKeySecret', 'signName', 'templateCode'] as const)(
    'never requests when %s is missing',
    async (key) => {
      const { sender, request } = gateway(response({ Code: 'OK' }), { ...config, [key]: '' });
      expect(await sender.send(input)).toEqual({
        status: 'failed',
        errorCode: 'SMS_NOT_CONFIGURED',
      });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'two variables', '__proto__', 'code\r\nBad: x'])(
    'rejects invalid template variable %j before requesting',
    async (codeVariable) => {
      const { sender, request } = gateway(response({ Code: 'OK' }), { ...config, codeVariable });
      expect(await sender.send(input)).toEqual({
        status: 'failed',
        errorCode: 'SMS_NOT_CONFIGURED',
      });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([
    { phone: '13800138000' },
    { phone: '+85212345678' },
    { phone: '+8613800138000,+8613900139000' },
    { code: '12345' },
    { code: '12345x' },
    { requestId: '' },
    { requestId: 'x'.repeat(129) },
    { requestId: 'x\r\nInjected: value' },
  ])('rejects invalid single-recipient input without requesting: %j', async (changes) => {
    const { sender, request } = gateway(response({ Code: 'OK' }));
    expect(await sender.send({ ...input, ...changes })).toEqual({
      status: 'failed',
      errorCode: 'SMS_INVALID_INPUT',
    });
    expect(request).not.toHaveBeenCalled();
  });
});
