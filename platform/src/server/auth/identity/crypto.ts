import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
export function identityCrypto(secret: string) {
  const key = createHash('sha256').update('yingzao-identity-v1\0').update(secret).digest();
  return {
    digest(domain: string, value: string) {
      return createHmac('sha256', key).update(`${domain}\0${value}`).digest('hex');
    },
    equals(left: string, right: string) {
      const a = Buffer.from(left),
        b = Buffer.from(right);
      return a.length === b.length && timingSafeEqual(a, b);
    },
    seal(value: unknown, aad: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad));
      const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return [
        'v1',
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        body.toString('base64url'),
      ].join('.');
    },
    open(value: string, aad: string): unknown {
      const [v, iv, tag, body, ...extra] = value.split('.');
      if (v !== 'v1' || !iv || !tag || !body || extra.length)
        throw new Error('Identity payload is unreadable');
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      cipher.setAAD(Buffer.from(aad));
      cipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return JSON.parse(
        Buffer.concat([cipher.update(Buffer.from(body, 'base64url')), cipher.final()]).toString(
          'utf8',
        ),
      );
    },
  };
}
