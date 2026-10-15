import { z } from 'zod';
import { CoreContext, id, now, str, num, json, nullable } from './shared';
import {
  CharacterAuthorizationInputSchema,
  ReasonInputSchema,
  type Actor,
} from '../../contracts/core';
import { AppError } from '../errors';
export const authorizationInput = CharacterAuthorizationInputSchema;
export interface AuthorizationDto {
  status: 'not-declared' | 'active' | 'withdrawn' | 'stale';
  referenceRevision: number;
  statementVersion: 'reference-use-v1';
  authorizedAt: string | null;
  withdrawnAt: string | null;
  subjectRelationship: 'self' | 'authorized-representative' | null;
}
export interface IdentityProvider {
  id: string;
  createSession(input: {
    characterId: string;
    assetIds: string[];
    referenceRevision: number;
  }): Promise<{ id: string; url: string; expiresAt: string }>;
  poll(
    sessionId: string,
  ): Promise<
    | { status: 'processing' | 'failed' | 'expired'; message?: string }
    | { status: 'active'; evidenceReference: string; expiresAt: string }
  >;
}
export function characterAuthorization(
  c: CoreContext,
  cid: string,
  revision: number,
): AuthorizationDto {
  const row = c.get(
    'SELECT * FROM character_authorizations WHERE character_id=? ORDER BY rowid DESC LIMIT 1',
    cid,
  );
  return {
    status: row
      ? num(row, 'reference_revision') === revision
        ? (str(row, 'status') as AuthorizationDto['status'])
        : 'stale'
      : 'not-declared',
    referenceRevision: revision,
    statementVersion: 'reference-use-v1',
    authorizedAt: row ? str(row, 'authorized_at') : null,
    withdrawnAt: row ? nullable(row, 'withdrawn_at') : null,
    subjectRelationship: row
      ? (str(row, 'subject_relationship') as AuthorizationDto['subjectRelationship'])
      : null,
  };
}
export class IdentityService {
  constructor(
    private c: CoreContext,
    private provider?: IdentityProvider,
  ) {}
  getAuthorization(actor: Actor, wid: string, cid: string) {
    this.c.requireAccess(actor, wid, 'read');
    const character = this.c.resource('character_profiles', wid, cid);
    return characterAuthorization(this.c, cid, num(character, 'reference_revision'));
  }
  authorize(actor: Actor, wid: string, cid: string, raw: unknown) {
    const input = authorizationInput.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      const character = this.c.resource('character_profiles', wid, cid);
      const refs = json<string[]>(character.reference_asset_ids_json, []);
      if (!refs.length) throw new AppError(400, 'REFERENCE_REQUIRED', '请先添加普通参考素材');
      for (const assetId of refs) this.c.resource('assets', wid, assetId);
      const current = this.getAuthorization(actor, wid, cid);
      if (current.status === 'active') return current;
      this.c.run(
        "UPDATE character_authorizations SET status='stale' WHERE character_id=? AND status='active'",
        cid,
      );
      this.c.run(
        "INSERT INTO character_authorizations(id,character_id,workspace_id,reference_revision,asset_ids_json,statement_version,subject_relationship,status,authorized_by,authorized_at) VALUES(?,?,?,?,?,?,?,'active',?,?)",
        id(),
        cid,
        wid,
        num(character, 'reference_revision'),
        JSON.stringify(refs),
        input.statementVersion,
        input.subjectRelationship,
        actor.userId,
        now(),
      );
      this.c.audit(actor, wid, 'character.authorization-declared', 'character', cid, {
        referenceRevision: num(character, 'reference_revision'),
        statementVersion: input.statementVersion,
        subjectRelationship: input.subjectRelationship,
      });
      return this.getAuthorization(actor, wid, cid);
    });
  }
  withdraw(actor: Actor, wid: string, cid: string, raw: unknown) {
    const input = ReasonInputSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      this.c.resource('character_profiles', wid, cid);
      this.c.run(
        "UPDATE character_authorizations SET status='withdrawn',withdrawn_at=?,withdrawal_reason=? WHERE character_id=? AND status='active'",
        now(),
        input.reason,
        cid,
      );
      this.c.run(
        "UPDATE identity_sessions SET status='withdrawn',updated_at=? WHERE character_id=? AND status IN ('processing','active')",
        now(),
        cid,
      );
      this.c.run(
        "UPDATE character_profiles SET verification_status='unverified',verification_provider_id=NULL,verification_expires_at=NULL,updated_at=? WHERE id=?",
        now(),
        cid,
      );
      this.c.audit(actor, wid, 'character.authorization-withdrawn', 'character', cid, {
        reason: input.reason,
      });
      return this.getAuthorization(actor, wid, cid);
    });
  }
  assertCanReference(actor: Actor, wid: string, cid: string) {
    const authorization = this.getAuthorization(actor, wid, cid);
    if (authorization.status !== 'active')
      throw new AppError(
        409,
        'CHARACTER_AUTHORIZATION_REQUIRED',
        '人物参考授权尚未声明、已撤回或素材版本已改变',
      );
    const character = this.c.resource('character_profiles', wid, cid);
    return {
      id: cid,
      referenceRevision: num(character, 'reference_revision'),
      referenceAssetIds: json<string[]>(character.reference_asset_ids_json, []),
    };
  }
  verification(actor: Actor, wid: string, cid: string) {
    this.c.requireAccess(actor, wid, 'read');
    this.c.resource('character_profiles', wid, cid);
    this.expire(cid);
    const sessions = this.c
      .all(
        'SELECT * FROM identity_sessions WHERE character_id=? AND workspace_id=? ORDER BY created_at DESC',
        cid,
        wid,
      )
      .map((r) => ({
        id: str(r, 'id'),
        status: str(r, 'status'),
        providerId: str(r, 'provider_id'),
        verificationUrl: str(r, 'status') === 'processing' ? str(r, 'verification_url') : null,
        expiresAt: str(r, 'expires_at'),
        errorMessage: nullable(r, 'error_message'),
        referenceRevision: num(r, 'reference_revision'),
        createdAt: str(r, 'created_at'),
      }));
    return {
      configured: !!this.provider,
      reason: this.provider
        ? null
        : '尚未连接正式身份认证服务；当前授权声明仅用于普通参考，不代表身份已核验。',
      sessions,
    };
  }
  private expire(cid: string) {
    const date = now();
    this.c.run(
      "UPDATE identity_sessions SET status='expired',updated_at=? WHERE character_id=? AND status IN ('processing','active') AND expires_at<=?",
      date,
      cid,
      date,
    );
    this.c.run(
      "UPDATE character_profiles SET verification_status='expired',updated_at=? WHERE id=? AND verification_status IN ('verified','pending') AND verification_expires_at<=?",
      date,
      cid,
      date,
    );
  }
  async startVerification(actor: Actor, wid: string, cid: string) {
    this.c.requireAccess(actor, wid, 'write');
    const reference = this.assertCanReference(actor, wid, cid);
    if (!this.provider)
      throw new AppError(
        503,
        'FACE_PROVIDER_UNAVAILABLE',
        '正式身份认证服务未配置；不会生成认证二维码或已核验记录',
      );
    const session = z
      .object({
        id: z.string().min(1),
        url: z.url().refine((v) => new URL(v).protocol === 'https:'),
        expiresAt: z.iso.datetime().refine((v) => Date.parse(v) > Date.now()),
      })
      .parse(
        await this.provider.createSession({
          characterId: cid,
          assetIds: reference.referenceAssetIds,
          referenceRevision: reference.referenceRevision,
        }),
      );
    this.c.transaction(() => {
      const current = this.assertCanReference(actor, wid, cid);
      if (current.referenceRevision !== reference.referenceRevision)
        throw new AppError(409, 'CHARACTER_CHANGED', '素材已修改，请重新认证');
      this.c.run(
        "INSERT INTO identity_sessions(id,workspace_id,character_id,reference_revision,provider_id,provider_session_id,verification_url,status,expires_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'processing',?,?,?,?)",
        id(),
        wid,
        cid,
        reference.referenceRevision,
        this.provider!.id,
        session.id,
        session.url,
        session.expiresAt,
        actor.userId,
        now(),
        now(),
      );
      this.c.run(
        "UPDATE character_profiles SET verification_status='pending',verification_provider_id=?,verification_expires_at=?,updated_at=? WHERE id=?",
        this.provider!.id,
        session.expiresAt,
        now(),
        cid,
      );
    });
    return this.verification(actor, wid, cid);
  }
  async poll(actor: Actor, wid: string, cid: string, sessionId: string) {
    this.c.requireAccess(actor, wid, 'write');
    this.expire(cid);
    const session = this.c.get(
      'SELECT * FROM identity_sessions WHERE id=? AND workspace_id=? AND character_id=?',
      sessionId,
      wid,
      cid,
    );
    if (!session) throw new AppError(404, 'NOT_FOUND', '认证会话不存在');
    if (session.status !== 'processing') return this.verification(actor, wid, cid);
    if (!this.provider || str(session, 'provider_id') !== this.provider.id)
      throw new AppError(503, 'FACE_PROVIDER_UNAVAILABLE', '认证服务未配置');
    const result = await this.provider.poll(str(session, 'provider_session_id'));
    this.c.transaction(() => {
      const character = this.c.resource('character_profiles', wid, cid);
      const currentSession = this.c.get(
        'SELECT status FROM identity_sessions WHERE id=?',
        sessionId,
      );
      if (currentSession?.status !== 'processing') return;
      if (
        num(character, 'reference_revision') !== num(session, 'reference_revision') ||
        this.getAuthorization(actor, wid, cid).status !== 'active'
      ) {
        this.c.run(
          "UPDATE identity_sessions SET status='expired',updated_at=? WHERE id=?",
          now(),
          sessionId,
        );
        return;
      }
      if (result.status === 'active') {
        if (
          !result.evidenceReference?.trim() ||
          !z.iso.datetime().safeParse(result.expiresAt).success ||
          Date.parse(result.expiresAt) <= Date.now()
        )
          throw new AppError(502, 'INVALID_IDENTITY_EVIDENCE', '服务未提供有效认证证据');
        this.c.run(
          "UPDATE identity_sessions SET status='active',evidence_reference=?,expires_at=?,updated_at=? WHERE id=?",
          result.evidenceReference,
          result.expiresAt,
          now(),
          sessionId,
        );
        this.c.run(
          "UPDATE character_profiles SET verification_status='verified',verification_provider_id=?,verification_expires_at=?,updated_at=? WHERE id=?",
          this.provider!.id,
          result.expiresAt,
          now(),
          cid,
        );
      } else {
        this.c.run(
          'UPDATE identity_sessions SET status=?,error_message=?,updated_at=? WHERE id=?',
          result.status,
          result.message ?? null,
          now(),
          sessionId,
        );
        this.c.run(
          'UPDATE character_profiles SET verification_status=?,updated_at=? WHERE id=?',
          result.status === 'processing'
            ? 'pending'
            : result.status === 'expired'
              ? 'expired'
              : 'rejected',
          now(),
          cid,
        );
      }
    });
    return this.verification(actor, wid, cid);
  }
}
