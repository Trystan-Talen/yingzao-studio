import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/server/config';

function production() {
  return {
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://studio.example.test',
    SESSION_SECRET: randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
}
describe('production configuration boundaries', () => {
  it.each(['x', ' '.repeat(64), 'example-secret'])(
    'rejects weak signing and encryption secrets',
    (secret) => {
      expect(() => loadConfig({ ...production(), SESSION_SECRET: secret })).toThrow();
      expect(() => loadConfig({ ...production(), ENCRYPTION_KEY: secret })).toThrow();
    },
  );
  it('requires independent secrets', () => {
    const env = production();
    expect(() => loadConfig({ ...env, ENCRYPTION_KEY: env.SESSION_SECRET })).toThrow();
  });
  it.each([
    'https://user:password@studio.example.test',
    'https://studio.example.test/subpath',
    'https://studio.example.test?token=private',
    'https://studio.example.test#private',
    'ftp://127.0.0.1',
  ])('requires a bare HTTP(S) public origin', (PUBLIC_ORIGIN) => {
    expect(() => loadConfig({ ...production(), PUBLIC_ORIGIN })).toThrow();
  });
  it('accepts independent random secrets and an HTTPS origin', () => {
    expect(loadConfig(production()).isProduction).toBe(true);
  });
  it('keeps IPv6 loopback available for an isolated production verification', () => {
    expect(loadConfig({ ...production(), PUBLIC_ORIGIN: 'http://[::1]:4310' }).publicOrigin).toBe(
      'http://[::1]:4310',
    );
  });
});
