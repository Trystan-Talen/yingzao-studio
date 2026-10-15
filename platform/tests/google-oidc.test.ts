/** Real local HTTP, local RSA signatures and isolated SQLite; never contacts Google or links a real account. */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT, type JWTPayload, type JWK } from 'jose';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import type { Actor } from '../src/contracts/core';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import { createCreditService } from '../src/server/tasks/credits';
import { createBillingAdmin } from '../src/server/billing/admin';
import {
  createGoogleGateway,
  createGoogleAuthService,
  registerGoogleRoutes,
  type GoogleAuthService,
  type GoogleServiceConfig,
} from '../src/server/auth/google';
import { AppError } from '../src/server/errors';
let signing: Awaited<ReturnType<typeof generateKeyPair>>,
  other: Awaited<ReturnType<typeof generateKeyPair>>,
  publicKey: JWK,
  otherPublic: JWK;
let folder: string,
  db: DatabaseContext,
  core: CoreServices,
  service: GoogleAuthService,
  config: GoogleServiceConfig,
  actor: Actor,
  sessionToken: string,
  server: Server,
  localOrigin: string;
let tokenMap: Map<string, { jwt: string; challenge: string }>,
  forms: URLSearchParams[],
  discoveryChanges: Record<string, unknown>,
  published: JWK[],
  requests: string[];
const clientId = 'test-client.apps.googleusercontent.com',
  clientSecret = 'test-only-client-secret',
  origin = 'http://127.0.0.1:5174';
const issuer = 'https://accounts.google.com',
  discoveryUrl = `${issuer}/.well-known/openid-configuration`,
  jwksUrl = 'https://www.googleapis.com/oauth2/v3/certs',
  tokenUrl = 'https://oauth2.googleapis.com/token';
const discovery = {
  issuer,
  authorization_endpoint: `${issuer}/o/oauth2/v2/auth`,
  token_endpoint: tokenUrl,
  jwks_uri: jwksUrl,
  response_types_supported: ['code'],
  id_token_signing_alg_values_supported: ['RS256'],
};
beforeAll(async () => {
  signing = await generateKeyPair('RS256');
  other = await generateKeyPair('RS256');
  publicKey = { ...(await exportJWK(signing.publicKey)), kid: 'key-1', alg: 'RS256', use: 'sig' };
  otherPublic = { ...(await exportJWK(other.publicKey)), kid: 'key-2', alg: 'RS256', use: 'sig' };
});
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-google-'));
  const migrations = join(folder, 'migrations');
  await mkdir(migrations);
  for (const name of (await readdir(resolve('migrations'))).filter((n) => /^\d+.*\.sql$/.test(n)))
    await copyFile(resolve('migrations', name), join(migrations, name));
  db = createDatabaseContext(join(folder, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: migrations });
  const credits = createCreditService(db);
  core = createCoreServices(
    db,
    {
      storageDir: join(folder, 'media'),
      sessionSecret: 'test-only-session',
      publicOrigin: origin,
      isProduction: false,
      demoMode: false,
    },
    {
      onWorkspaceCreated: (w, u) => credits.initialize(w, u, 0),
      onMemberBudgetChanged: (w, u, l) => credits.budget(w, u, l),
    },
  );
  const owner = await core.auth.register({
    email: 'owner@example.local',
    password: 'OwnerPassword2026!',
    displayName: 'Owner',
  });
  actor = {
    userId: owner.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  sessionToken = owner.sessionToken;
  config = {
    publicOrigin: origin,
    encryptionKey: 'test-only-encryption',
    isProduction: false,
    google: { enabled: true, clientId, clientSecret },
  };
  tokenMap = new Map();
  forms = [];
  discoveryChanges = {};
  published = [publicKey];
  requests = [];
  server = createServer(async (req, res) => {
    requests.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/discovery') {
      res.end(JSON.stringify({ ...discovery, ...discoveryChanges }));
      return;
    }
    if (req.url === '/jwks') {
      res.end(JSON.stringify({ keys: published }));
      return;
    }
    if (req.url === '/token') {
      let data = '';
      for await (const chunk of req) data += String(chunk);
      const form = new URLSearchParams(data);
      forms.push(form);
      const result = tokenMap.get(form.get('code') ?? '');
      if (
        req.method !== 'POST' ||
        !result ||
        form.get('client_id') !== clientId ||
        form.get('client_secret') !== clientSecret ||
        form.get('grant_type') !== 'authorization_code' ||
        form.get('redirect_uri') !== `${origin}/api/v1/auth/google/callback` ||
        createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url') !== result.challenge
      ) {
        res.statusCode = 400;
        res.end('{"error":"invalid_grant"}');
        return;
      }
      res.end(
        JSON.stringify({
          id_token: result.jwt,
          access_token: 'test-access-token-never-stored',
          refresh_token: 'test-refresh-token-never-stored',
          token_type: 'Bearer',
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server missing');
  localOrigin = `http://127.0.0.1:${address.port}`;
  service = createGoogleAuthService(db, core, config, { gateway: gateway() });
});
afterEach(async () => {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  closeDatabase(db);
  await rm(folder, { recursive: true, force: true });
});
function gateway() {
  return createGoogleGateway(
    { clientId, clientSecret, redirectUri: `${origin}/api/v1/auth/google/callback` },
    {
      fetch: async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const route = (
          { [discoveryUrl]: '/discovery', [jwksUrl]: '/jwks', [tokenUrl]: '/token' } as Record<
            string,
            string
          >
        )[url];
        if (!route) throw new Error('Attempted external network');
        return fetch(`${localOrigin}${route}`, init);
      },
    },
  );
}
function current() {
  return { actor, sessionToken };
}
function values(flow: Awaited<ReturnType<GoogleAuthService['start']>>) {
  const url = new URL(flow.authorizationUrl);
  return {
    state: url.searchParams.get('state')!,
    nonce: url.searchParams.get('nonce')!,
    challenge: url.searchParams.get('code_challenge')!,
  };
}
async function issue(
  flow: Awaited<ReturnType<GoogleAuthService['start']>>,
  claims: JWTPayload = {},
  which = 'key-1',
) {
  const value = values(flow),
    time = Math.floor(Date.now() / 1000),
    code = `fixture-${randomUUID()}`;
  const jwt = await new SignJWT({
    iss: issuer,
    sub: 'google-person-1',
    aud: clientId,
    iat: time,
    exp: time + 3600,
    nonce: value.nonce,
    email: 'person@example.local',
    email_verified: true,
    name: 'Google Person',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: which })
    .sign(which === 'key-1' ? signing.privateKey : other.privateKey);
  tokenMap.set(code, { jwt, challenge: value.challenge });
  return { code, state: value.state };
}
function invite(email = 'person@example.local') {
  const team = core.team.create(actor, { name: 'Google invite team' }),
    invitation = core.team.invite(actor, team.id, { email, role: 'member' });
  return { team, invitation, token: new URL(invitation.inviteUrl).hash.slice('#token='.length) };
}
async function invitedFlow(email = 'person@example.local') {
  const invitation = invite(email),
    flow = await service.start({ inviteToken: invitation.token });
  return { invitation, flow };
}
describe('Google protocol and cryptographic verification', () => {
  it('upgrades the already-applied original 0016 through 0018 without rewriting history or losing accounts and bindings', async () => {
    const legacyDir = join(folder, 'legacy-migrations');
    await mkdir(legacyDir);
    for (const name of (await readdir(resolve('migrations'))).filter(
      (name) => /^\d+.*\.sql$/.test(name) && Number.parseInt(name, 10) <= 17,
    ))
      await copyFile(resolve('migrations', name), join(legacyDir, name));
    const legacy = createDatabaseContext(join(folder, 'legacy.sqlite'));
    try {
      migrateDatabase(legacy, { migrationsDir: legacyDir });
      const old = createCoreServices(legacy, {
        storageDir: join(folder, 'legacy-media'),
        sessionSecret: 'test-legacy-secret',
        publicOrigin: origin,
        isProduction: false,
        demoMode: false,
      });
      const registered = await old.auth.register({
        email: 'old@example.local',
        password: 'PreserveOldPassword2026!',
        displayName: 'Original user',
      });
      expect(
        (legacy.sqlite.prepare('PRAGMA table_info(users)').all() as { name: string }[]).some(
          (c) => c.name === 'local_password_enabled',
        ),
      ).toBe(false);
      const date = new Date().toISOString();
      legacy.sqlite
        .prepare("INSERT INTO external_identities VALUES(?,'google',?,?,?,?,?,?)")
        .run(
          randomUUID(),
          issuer,
          'already-linked-subject',
          registered.user.id,
          'old@example.local',
          date,
          date,
        );
      const beforeUser = legacy.sqlite
        .prepare('SELECT * FROM users WHERE id=?')
        .get(registered.user.id) as Record<string, unknown>;
      const beforeIdentities = legacy.sqlite.prepare('SELECT * FROM external_identities').all();
      const beforeMemberships = legacy.sqlite.prepare('SELECT * FROM memberships').all();
      const beforeMigration = legacy.sqlite
        .prepare("SELECT * FROM schema_migrations WHERE name='0016-google-oidc.sql'")
        .get() as { checksum: string };
      expect(beforeMigration.checksum).toBe(
        'e7b91321611346c4f1c07afe270d317ea66a60dbd7d4970eb8de6ff9d5723ed8',
      );
      migrateDatabase(legacy, { migrationsDir: resolve('migrations') });
      migrateDatabase(legacy, { migrationsDir: resolve('migrations') });
      const afterUser = legacy.sqlite
        .prepare('SELECT * FROM users WHERE id=?')
        .get(registered.user.id) as Record<string, unknown>;
      expect(afterUser).toEqual({ ...beforeUser, local_password_enabled: 1 });
      expect(legacy.sqlite.prepare('SELECT * FROM external_identities').all()).toEqual(
        beforeIdentities,
      );
      expect(legacy.sqlite.prepare('SELECT * FROM memberships').all()).toEqual(beforeMemberships);
      expect(
        legacy.sqlite
          .prepare("SELECT * FROM schema_migrations WHERE name='0016-google-oidc.sql'")
          .get(),
      ).toEqual(beforeMigration);
      expect(
        legacy.sqlite
          .prepare(
            "SELECT checksum FROM schema_migrations WHERE name='0018-google-local-password.sql'",
          )
          .get(),
      ).toEqual({ checksum: '41002223e225d08f8813256669c0e0c277a7f98ac406e6c5d5f4735ecc478535' });
      expect(
        (await old.auth.login({ email: 'old@example.local', password: 'PreserveOldPassword2026!' }))
          .user.id,
      ).toBe(registered.user.id);
    } finally {
      closeDatabase(legacy);
    }
  });
  it('uses official discovery, state, nonce, S256 PKCE and fixed redirects; no identity/token secret persists in plaintext', async () => {
    const { flow, invitation } = await invitedFlow();
    const url = new URL(flow.authorizationUrl);
    expect(url.origin + url.pathname).toBe(discovery.authorization_endpoint);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(`${origin}/api/v1/auth/google/callback`);
    expect(url.searchParams.has('client_secret')).toBe(false);
    const row = db.sqlite.prepare('SELECT * FROM google_oidc_flows').get();
    expect(JSON.stringify(row)).not.toContain(values(flow).nonce);
    expect(JSON.stringify(row)).not.toContain(invitation.token);
    expect(JSON.stringify(row)).not.toContain(flow.browserToken);
    const callback = await issue(flow),
      result = await service.complete(callback, flow.browserToken);
    expect(result.sessionToken).toBeTruthy();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      db.sqlite.prepare('SELECT status,encrypted_context FROM google_oidc_flows').get(),
    ).toEqual({ status: 'succeeded', encrypted_context: '' });
    expect(
      JSON.stringify(db.sqlite.prepare('SELECT * FROM external_identities').all()),
    ).not.toMatch(/access-token|refresh-token|id_token/);
    expect(
      db.sqlite
        .prepare('SELECT COUNT(*) n FROM memberships WHERE workspace_id=?')
        .get(invitation.team.id),
    ).toEqual({ n: 2 });
  });
  it.each([
    ['issuer', { iss: 'https://attacker.example' }],
    ['audience', { aud: 'other-client' }],
    ['authorized party', { azp: 'other-client' }],
    ['multi audience without authorized party', { aud: [clientId, 'other'] }],
    ['nonce', { nonce: 'replayed-nonce' }],
    ['expired', { exp: 1 }],
    ['future issued', { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ['unverified email', { email_verified: false }],
    ['string verified', { email_verified: 'true' }],
    ['missing subject', { sub: '' }],
  ])('rejects invalid %s before creating an identity', async (_name, claims) => {
    const { flow } = await invitedFlow(),
      callback = await issue(flow, claims as JWTPayload);
    await expect(service.complete(callback, flow.browserToken)).rejects.toMatchObject({
      code: 'GOOGLE_TOKEN_INVALID',
    });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM external_identities').get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 1 });
  });
  it('rejects a token signed by a different private key despite a trusted kid', async () => {
    const { flow } = await invitedFlow(),
      callback = await issue(flow);
    const signed = tokenMap.get(callback.code)!;
    const time = Math.floor(Date.now() / 1000);
    signed.jwt = await new SignJWT({
      iss: issuer,
      sub: 'attacker',
      aud: clientId,
      iat: time,
      exp: time + 3600,
      nonce: values(flow).nonce,
      email: 'person@example.local',
      email_verified: true,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .sign(other.privateKey);
    await expect(service.complete(callback, flow.browserToken)).rejects.toMatchObject({
      code: 'GOOGLE_TOKEN_INVALID',
    });
  });
  it('refreshes official JWKS on a new kid and accepts Google legacy issuer spelling', async () => {
    const { flow } = await invitedFlow(),
      callback = await issue(flow);
    await service.complete(callback, flow.browserToken);
    published = [otherPublic];
    const next = await service.start({}),
      second = await issue(next, { iss: 'accounts.google.com' }, 'key-2');
    const result = await service.complete(second, next.browserToken);
    expect(result.userId).toBe(
      (db.sqlite.prepare('SELECT user_id FROM external_identities').get() as { user_id: string })
        .user_id,
    );
    expect(requests.filter((p) => p === '/jwks')).toHaveLength(2);
  });
  it('rejects discovery endpoint substitution without fetching an arbitrary host', async () => {
    discoveryChanges = { jwks_uri: 'http://127.0.0.1/private-key' };
    await expect(service.start({})).rejects.toMatchObject({ code: 'GOOGLE_DISCOVERY_INVALID' });
    expect(requests).toEqual(['/discovery']);
  });
});
describe('single-use flows and account admission', () => {
  it('fails closed when disabled, incomplete, or still in first-admin setup', async () => {
    config.google!.enabled = false;
    expect(service.status()).toMatchObject({ available: false });
    await expect(service.start({})).rejects.toMatchObject({ code: 'GOOGLE_NOT_CONFIGURED' });
    config.google!.enabled = true;
    config.google!.clientSecret = '';
    await expect(service.start({})).rejects.toMatchObject({ code: 'GOOGLE_NOT_CONFIGURED' });
    config.google!.clientSecret = clientSecret;
    const fresh = createDatabaseContext(join(folder, 'empty.sqlite'));
    try {
      migrateDatabase(fresh, { migrationsDir: join(folder, 'migrations') });
      const first = createCoreServices(fresh, core.context.config);
      const unavailable = createGoogleAuthService(fresh, first, config, { gateway: gateway() });
      await expect(unavailable.start({})).rejects.toMatchObject({ code: 'LOCAL_SETUP_ONLY' });
    } finally {
      closeDatabase(fresh);
    }
  });
  it('does not consume a flow for wrong state/browser, but rejects replay after a real completion', async () => {
    const { flow } = await invitedFlow(),
      callback = await issue(flow);
    await expect(
      service.complete({ ...callback, state: 'x'.repeat(43) }, flow.browserToken),
    ).rejects.toMatchObject({ code: 'GOOGLE_STATE_INVALID' });
    await expect(service.complete(callback, 'wrong-browser')).rejects.toMatchObject({
      code: 'GOOGLE_STATE_INVALID',
    });
    expect(forms).toHaveLength(0);
    await service.complete(callback, flow.browserToken);
    await expect(service.complete(callback, flow.browserToken)).rejects.toMatchObject({
      code: 'GOOGLE_STATE_INVALID',
    });
    expect(forms).toHaveLength(1);
  });
  it('rejects expired and cancelled flows without exchanging their authorization codes', async () => {
    const flow = await service.start({}),
      callback = await issue(flow);
    db.sqlite.prepare("UPDATE google_oidc_flows SET expires_at='2000-01-01T00:00:00.000Z'").run();
    await expect(service.complete(callback, flow.browserToken)).rejects.toMatchObject({
      code: 'GOOGLE_STATE_INVALID',
    });
    const next = await service.start({});
    await expect(
      service.complete({ state: values(next).state, error: 'access_denied' }, next.browserToken),
    ).rejects.toMatchObject({ code: 'GOOGLE_CANCELLED' });
    expect(forms).toHaveLength(0);
  });
  it('keeps closed registration closed and never automatically links by matching email', async () => {
    const flow = await service.start({}),
      callback = await issue(flow);
    await expect(service.complete(callback, flow.browserToken)).rejects.toMatchObject({
      code: 'REGISTRATION_CLOSED',
    });
    const collision = await service.start({}),
      c = await issue(collision, { email: 'owner@example.local' });
    await expect(service.complete(c, collision.browserToken)).rejects.toMatchObject({
      code: 'GOOGLE_EMAIL_LINK_REQUIRED',
    });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM external_identities').get()).toEqual({ n: 0 });
  });
  it('consumes matching invitations atomically, rejects mismatched verified emails and rolls back registration on seat exhaustion', async () => {
    const { flow, invitation } = await invitedFlow();
    await expect(
      service.complete(await issue(flow, { email: 'wrong@example.local' }), flow.browserToken),
    ).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
    expect(
      db.sqlite
        .prepare('SELECT consumed_at FROM invitations WHERE id=?')
        .get(invitation.invitation.id),
    ).toEqual({ consumed_at: null });
    const admin = createBillingAdmin(db);
    admin.configureEntitlements({
      actorUserId: actor.userId,
      reason: 'Test operator deliberately lowers available seats before callback.',
      mode: 'standard',
      limits: { ...core.entitlements.effective(invitation.team.id).limits, seats: 1 },
    });
    const next = await service.start({ inviteToken: invitation.token });
    await expect(service.complete(await issue(next), next.browserToken)).rejects.toMatchObject({
      code: 'ENTITLEMENT_LIMIT',
    });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 1 });
    expect(
      db.sqlite
        .prepare('SELECT consumed_at FROM invitations WHERE id=?')
        .get(invitation.invitation.id),
    ).toEqual({ consumed_at: null });
  });
  it('deduplicates concurrent callbacks for the same Google subject and consumes an invitation once', async () => {
    const invitation = invite(),
      flows = await Promise.all([
        service.start({ inviteToken: invitation.token }),
        service.start({ inviteToken: invitation.token }),
      ]),
      callbacks = await Promise.all(flows.map((f) => issue(f)));
    const result = await Promise.all(
      flows.map((f, n) => service.complete(callbacks[n]!, f.browserToken)),
    );
    expect(result[0]!.userId).toBe(result[1]!.userId);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM external_identities').get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 2 });
    expect(
      db.sqlite
        .prepare('SELECT COUNT(*) n FROM memberships WHERE workspace_id=?')
        .get(invitation.team.id),
    ).toEqual({ n: 2 });
    const third = await service.start({ inviteToken: invitation.token });
    await expect(
      service.complete(await issue(third, { sub: 'second-google-person' }), third.browserToken),
    ).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_LINK_REQUIRED' });
  });
  it('preserves verified referral registration rules and attributes once', async () => {
    const admin = createBillingAdmin(db);
    admin.configureReferrals({
      actorUserId: actor.userId,
      reason: 'Enable only synthetic referral registration for this isolated test.',
      registrationEnabled: true,
      rewardsEnabled: false,
      rewardCredits: 0,
      minimumPaidMinor: 100,
      currency: 'USD',
    });
    const referral = core.business.referrals(actor, core.auth.me(actor).activeWorkspaceId!),
      flow = await service.start({ referralCode: referral.inviteCode });
    const result = await service.complete(await issue(flow), flow.browserToken);
    expect(db.sqlite.prepare('SELECT user_id FROM referral_attributions').get()).toEqual({
      user_id: result.userId,
    });
  });
});
describe('explicit account linking and safe HTTP surface', () => {
  it('marks Google-only users, rejects password login, and prevents removing their only login method', async () => {
    const { flow } = await invitedFlow();
    const result = await service.complete(await issue(flow), flow.browserToken);
    const googleActor = { ...actor, userId: result.userId };
    expect(service.status(googleActor)).toMatchObject({ linked: true, hasLocalPassword: false });
    expect(service.status()).toMatchObject({
      linked: false,
      hasLocalPassword: false,
      identity: null,
    });
    // Even a known matching hash cannot enable an explicitly disabled local login method.
    db.sqlite
      .prepare(
        'UPDATE users SET password_hash=(SELECT password_hash FROM users WHERE id=?) WHERE id=?',
      )
      .run(actor.userId, result.userId);
    await expect(
      core.auth.login({ email: 'person@example.local', password: 'OwnerPassword2026!' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(
      core.auth.confirmPassword(googleActor, 'OwnerPassword2026!'),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(
      service.unlink(
        { actor: googleActor, sessionToken: result.sessionToken! },
        { password: 'OwnerPassword2026!' },
      ),
    ).rejects.toMatchObject({ code: 'GOOGLE_LOCAL_PASSWORD_REQUIRED' });
    expect(service.status(googleActor).linked).toBe(true);
  });
  it('atomically consumes the same callback before any concurrent token exchange', async () => {
    const { flow } = await invitedFlow();
    const callback = await issue(flow);
    const result = await Promise.allSettled([
      service.complete(callback, flow.browserToken),
      service.complete(callback, flow.browserToken),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(forms).toHaveLength(1);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM external_identities').get()).toEqual({ n: 1 });
  });
  it('requires immediate password confirmation, binds callback to the same unrevoked session, and preserves local email', async () => {
    await expect(service.startLink(current(), { password: 'wrong' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    const flow = await service.startLink(current(), { password: 'OwnerPassword2026!' }),
      callback = await issue(flow, { email: 'different@example.local' });
    await expect(
      service.complete(callback, flow.browserToken, 'other-session'),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    const result = await service.complete(callback, flow.browserToken, sessionToken);
    expect(result).toMatchObject({ intent: 'link', userId: actor.userId, sessionToken: undefined });
    expect(core.auth.me(actor).user.email).toBe('owner@example.local');
    expect(service.status(actor)).toMatchObject({
      linked: true,
      identity: { email: 'different@example.local' },
    });
    const next = await service.startLink(current(), { password: 'OwnerPassword2026!' });
    core.auth.logout(sessionToken);
    await expect(
      service.complete(await issue(next), next.browserToken, sessionToken),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
  it('does not link if the confirmed session is revoked during the upstream token exchange', async () => {
    const actual = gateway();
    const concurrent = createGoogleAuthService(db, core, config, {
      gateway: {
        authorize: actual.authorize,
        exchange: async (input) => {
          const identity = await actual.exchange(input);
          core.auth.logout(sessionToken);
          return identity;
        },
      },
    });
    const flow = await concurrent.startLink(current(), { password: 'OwnerPassword2026!' });
    await expect(
      concurrent.complete(
        await issue(flow, { email: 'owner@example.local' }),
        flow.browserToken,
        sessionToken,
      ),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM external_identities').get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare('SELECT status FROM google_oidc_flows').get()).toEqual({
      status: 'failed',
    });
  });
  it('expires password-confirmed linking after five minutes and cannot exchange an expired flow', async () => {
    const flow = await service.startLink(current(), { password: 'OwnerPassword2026!' });
    const row = db.sqlite.prepare('SELECT created_at,expires_at FROM google_oidc_flows').get() as {
      created_at: string;
      expires_at: string;
    };
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBeLessThanOrEqual(300001);
    db.sqlite.prepare("UPDATE google_oidc_flows SET expires_at='2000-01-01T00:00:00.000Z'").run();
    await expect(
      service.complete(await issue(flow), flow.browserToken, sessionToken),
    ).rejects.toMatchObject({ code: 'GOOGLE_STATE_INVALID' });
    expect(forms).toHaveLength(0);
  });
  it('refuses cross-account subject reuse and never replaces an existing different Google binding', async () => {
    const { flow } = await invitedFlow();
    await service.complete(await issue(flow), flow.browserToken);
    const link = await service.startLink(current(), { password: 'OwnerPassword2026!' });
    await expect(
      service.complete(await issue(link), link.browserToken, sessionToken),
    ).rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_CONFLICT' });
    const ownerLink = await service.startLink(current(), { password: 'OwnerPassword2026!' });
    await service.complete(
      await issue(ownerLink, { sub: 'owner-google', email: 'owner@example.local' }),
      ownerLink.browserToken,
      sessionToken,
    );
    const otherLink = await service.startLink(current(), { password: 'OwnerPassword2026!' });
    await expect(
      service.complete(
        await issue(otherLink, { sub: 'another-google', email: 'owner@example.local' }),
        otherLink.browserToken,
        sessionToken,
      ),
    ).rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_CONFLICT' });
  });
  it('requires password to unlink, revokes other sessions and retains the confirmed local session', async () => {
    const flow = await service.startLink(current(), { password: 'OwnerPassword2026!' });
    await service.complete(
      await issue(flow, { email: 'owner@example.local' }),
      flow.browserToken,
      sessionToken,
    );
    const otherToken = core.auth.session(actor.userId);
    await expect(service.unlink(current(), { password: 'wrong' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(service.status(actor).linked).toBe(true);
    await service.unlink(current(), { password: 'OwnerPassword2026!' });
    expect(service.status(actor).linked).toBe(false);
    const h = (v: string) => createHash('sha256').update(v).digest('hex');
    expect(
      db.sqlite.prepare('SELECT revoked_at FROM sessions WHERE token_hash=?').get(h(sessionToken)),
    ).toEqual({ revoked_at: null });
    expect(
      db.sqlite.prepare('SELECT revoked_at FROM sessions WHERE token_hash=?').get(h(otherToken)),
    ).not.toEqual({ revoked_at: null });
  });
  it('validates same-origin starts, uses HttpOnly cookie binding, redirects only to fixed destinations and never exposes callback code', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(cookie);
    app.setErrorHandler((e, _q, r) =>
      r
        .code(e instanceof AppError ? e.statusCode : 400)
        .send({ error: { code: e instanceof AppError ? e.code : 'INVALID_INPUT' } }),
    );
    await registerGoogleRoutes(app, service, core);
    try {
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/auth/google/start', payload: {} }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/google/start',
            headers: { origin: 'https://attacker.example' },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/google/start',
            headers: { origin },
            payload: { returnTo: 'https://attacker.example' },
          })
        ).statusCode,
      ).toBe(400);
      const start = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/google/start',
          headers: { origin },
          payload: {},
        }),
        body = start.json().data as { authorizationUrl: string };
      expect(start.headers['set-cookie']).toContain('HttpOnly');
      expect(start.body).not.toContain('browserToken');
      const callback = new URL(body.authorizationUrl);
      const state = callback.searchParams.get('state')!;
      const response = await app.inject({
        url: `/api/v1/auth/google/callback?state=${state}&error=access_denied&code_leak=secret-code`,
        headers: { cookie: String(start.headers['set-cookie']).split(';')[0]! },
      });
      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe(`${origin}/login?google=error&code=GOOGLE_CANCELLED`);
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(JSON.stringify(response.headers)).not.toContain('secret-code');
    } finally {
      await app.close();
    }
  });
});
