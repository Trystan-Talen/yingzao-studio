import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { SmsConfig, SmsGateway } from './types';

const host = 'dysmsapi.aliyuncs.com';
const algorithm = 'ACS3-HMAC-SHA256';
const maxResponseBytes = 65_536;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Flat RPC query parameters only; callers must serialize JSON string fields first. */
export function signAliyunRequest(input: {
  method: string;
  pathname: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  accessKeyId: string;
  accessKeySecret: string;
  body?: string;
}): { query: string; headers: Record<string, string> } {
  const query = Object.keys(input.query)
    .sort()
    .map((key) => `${encode(key)}=${encode(input.query[key]!)}`)
    .join('&');
  const headers = Object.fromEntries(
    Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value.trim()]),
  );
  const payloadHash = sha256(input.body ?? '');
  headers['x-acs-content-sha256'] = payloadHash;
  const signedNames = Object.keys(headers)
    .filter((key) => key === 'host' || key === 'content-type' || key.startsWith('x-acs-'))
    .sort();
  const canonicalHeaders = signedNames.map((key) => `${key}:${headers[key]}\n`).join('');
  const signedHeaders = signedNames.join(';');
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.pathname.split('/').map(encode).join('/'),
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const signature = createHmac('sha256', input.accessKeySecret)
    .update(`${algorithm}\n${sha256(canonicalRequest)}`, 'utf8')
    .digest('hex');
  headers.authorization = `${algorithm} Credential=${input.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { query, headers };
}

export function isAliyunSmsConfigured(config: SmsConfig): boolean {
  const value = (text: string | undefined, max: number) =>
    !!text?.trim() && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text);
  return !!(
    value(config.accessKeyId, 256) &&
    /^[A-Za-z0-9._-]+$/.test(config.accessKeyId!) &&
    value(config.accessKeySecret, 256) &&
    value(config.signName, 100) &&
    value(config.templateCode, 128) &&
    (config.securityToken === undefined || value(config.securityToken, 16_384)) &&
    (config.codeVariable === undefined || /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(config.codeVariable))
  );
}

const uncertain = () => ({
  status: 'reconciliation_required' as const,
  errorCode: 'ALIYUN_SMS_UNCERTAIN',
});

export function createAliyunSmsGateway(
  config: SmsConfig,
  options: {
    request?: typeof fetch;
    now?: () => Date;
    nonce?: () => string;
  } = {},
): SmsGateway {
  const request = options.request ?? fetch;
  const now = options.now ?? (() => new Date());
  const nonce = options.nonce ?? randomUUID;
  return {
    async send(input) {
      if (!config.enabled) return { status: 'failed', errorCode: 'SMS_DISABLED' };
      if (!isAliyunSmsConfigured(config))
        return { status: 'failed', errorCode: 'SMS_NOT_CONFIGURED' };
      if (
        !/^\+861[3-9]\d{9}$/.test(input.phone) ||
        !/^\d{6}$/.test(input.code) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.requestId)
      ) {
        return { status: 'failed', errorCode: 'SMS_INVALID_INPUT' };
      }

      try {
        const signed = signAliyunRequest({
          method: 'POST',
          pathname: '/',
          query: {
            PhoneNumbers: input.phone.slice(3),
            SignName: config.signName!,
            TemplateCode: config.templateCode!,
            TemplateParam: JSON.stringify({ [config.codeVariable ?? 'code']: input.code }),
            OutId: input.requestId,
          },
          headers: {
            host,
            accept: 'application/json',
            'x-acs-action': 'SendSms',
            'x-acs-version': '2017-05-25',
            'x-acs-date': now()
              .toISOString()
              .replace(/\.\d{3}Z$/, 'Z'),
            'x-acs-signature-nonce': nonce(),
            ...(config.securityToken ? { 'x-acs-security-token': config.securityToken } : {}),
          },
          accessKeyId: config.accessKeyId!,
          accessKeySecret: config.accessKeySecret!,
        });
        // SendSms has no provider idempotency guarantee. Never retry an ambiguous call.
        const result = await request(`https://${host}/?${signed.query}`, {
          method: 'POST',
          headers: signed.headers,
          body: '',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        if (result.status >= 400 && result.status < 500) {
          await result.body?.cancel();
          return { status: 'failed', errorCode: 'ALIYUN_SMS_REJECTED' };
        }
        if (!result.ok) {
          await result.body?.cancel();
          return uncertain();
        }
        const text = await result.text();
        if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) return uncertain();
        const parsed: unknown = JSON.parse(text);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          !('Code' in parsed) ||
          typeof parsed.Code !== 'string' ||
          !parsed.Code
        ) {
          return uncertain();
        }
        // Only a provider UUID is retained; descriptions and arbitrary response fields are private.
        const requestId =
          'RequestId' in parsed &&
          typeof parsed.RequestId === 'string' &&
          /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(parsed.RequestId)
            ? { requestId: parsed.RequestId }
            : {};
        return parsed.Code === 'OK'
          ? { status: 'accepted', ...requestId }
          : { status: 'failed', errorCode: 'ALIYUN_SMS_REJECTED', ...requestId };
      } catch {
        // Network exceptions can contain the signed URL, phone, code or credentials.
        return uncertain();
      }
    },
  };
}
