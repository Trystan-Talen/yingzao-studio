import { EntitlementService } from './entitlements';
import { num } from './shared';
import { characterAuthorization } from './identity';
import * as inputs from '../../contracts/core';
import {
  BrandInputSchema,
  BrandPatchSchema,
  CharacterInputSchema,
  CharacterPatchSchema,
  type Actor,
  type BrandDto,
  type CharacterDto,
} from '../../contracts/core';
import { AppError } from '../errors';
import { CoreContext, type Row, type ListQuery, str, nullable, json, id, now } from './shared';
export class ReferenceService {
  constructor(private c: CoreContext) {}
  private images(wid: string, ids: string[]): void {
    for (const aid of ids) {
      const row = this.c.resource('assets', wid, aid);
      if (row.kind !== 'image') throw new AppError(400, 'IMAGE_REQUIRED', '参考素材必须是图片');
    }
  }
  private brandRow(actor: Actor, wid: string, bid: string, includeDeleted = false): Row {
    const row = this.c.resource('brands', wid, bid, includeDeleted);
    if (row.visibility === 'private' && row.created_by !== actor.userId)
      throw new AppError(404, 'NOT_FOUND', '品牌不存在');
    return row;
  }
  brandDto(row: Row): BrandDto {
    return {
      id: str(row, 'id'),
      workspaceId: str(row, 'workspace_id'),
      name: str(row, 'name'),
      description: str(row, 'description'),
      colors: json(row.colors_json, []),
      fonts: json(row.fonts_json, []),
      referenceAssetIds: this.c
        .all(
          'SELECT asset_id FROM brand_references WHERE brand_id=? ORDER BY position',
          str(row, 'id'),
        )
        .map((r) => str(r, 'asset_id')),
      coverAssetId: nullable(row, 'cover_asset_id'),
      visibility: str(row, 'visibility') as BrandDto['visibility'],
      createdBy: str(row, 'created_by'),
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at'),
      deletedAt: nullable(row, 'deleted_at'),
    };
  }
  getBrand(actor: Actor, wid: string, bid: string): BrandDto {
    this.c.requireAccess(actor, wid, 'read');
    return this.brandDto(this.brandRow(actor, wid, bid));
  }
  brands(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'read');
    return this.c.page(
      "SELECT * FROM brands WHERE workspace_id=? AND deleted_at IS NULL AND (visibility='workspace' OR created_by=?) AND name LIKE ? ORDER BY updated_at DESC,id",
      [wid, actor.userId, `%${q.q ?? ''}%`],
      q,
      (r) => this.brandDto(r),
    );
  }
  createBrand(actor: Actor, wid: string, raw: unknown): BrandDto {
    const input = BrandInputSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      new EntitlementService(this.c).assertCreate(wid, 'brands');
      this.images(wid, [
        ...input.referenceAssetIds,
        ...(input.coverAssetId ? [input.coverAssetId] : []),
      ]);
      const bid = id(),
        date = now();
      this.c.run(
        'INSERT INTO brands VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)',
        bid,
        wid,
        input.name,
        input.description,
        JSON.stringify(input.colors),
        JSON.stringify(input.fonts),
        input.coverAssetId ?? input.referenceAssetIds[0] ?? null,
        input.visibility,
        actor.userId,
        date,
        date,
      );
      input.referenceAssetIds.forEach((aid, position) =>
        this.c.run('INSERT INTO brand_references VALUES (?,?,?)', bid, aid, position),
      );
      this.c.audit(actor, wid, 'brand.create', 'brand', bid);
      return this.getBrand(actor, wid, bid);
    });
  }
  updateBrand(actor: Actor, wid: string, bid: string, raw: unknown): BrandDto {
    const input = BrandPatchSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      const old = this.getBrand(actor, wid, bid);
      const refs = input.referenceAssetIds ?? old.referenceAssetIds;
      this.images(wid, [...refs, ...(input.coverAssetId ? [input.coverAssetId] : [])]);
      this.c.run(
        'UPDATE brands SET name=?,description=?,colors_json=?,fonts_json=?,cover_asset_id=?,visibility=?,updated_at=? WHERE id=?',
        input.name ?? old.name,
        input.description ?? old.description,
        JSON.stringify(input.colors ?? old.colors),
        JSON.stringify(input.fonts ?? old.fonts),
        input.coverAssetId === undefined
          ? input.referenceAssetIds
            ? (refs[0] ?? null)
            : old.coverAssetId
          : input.coverAssetId,
        input.visibility ?? old.visibility,
        now(),
        bid,
      );
      if (input.referenceAssetIds) {
        this.c.run('DELETE FROM brand_references WHERE brand_id=?', bid);
        refs.forEach((aid, position) =>
          this.c.run('INSERT INTO brand_references VALUES (?,?,?)', bid, aid, position),
        );
      }
      return this.getBrand(actor, wid, bid);
    });
  }
  removeBrand(actor: Actor, wid: string, bid: string) {
    this.c.requireAccess(actor, wid, 'write');
    this.brandRow(actor, wid, bid);
    const date = now();
    this.c.run('UPDATE brands SET deleted_at=?,updated_at=? WHERE id=?', date, date, bid);
    return { id: bid, deletedAt: date };
  }
  restoreBrand(actor: Actor, wid: string, bid: string): BrandDto {
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      const brand = this.brandRow(actor, wid, bid, true);
      if (brand.deleted_at) new EntitlementService(this.c).assertCreate(wid, 'brands');
      this.c.run('UPDATE brands SET deleted_at=NULL,updated_at=? WHERE id=?', now(), bid);
      return this.getBrand(actor, wid, bid);
    });
  }
  characterDto(row: Row): CharacterDto {
    return {
      id: str(row, 'id'),
      workspaceId: str(row, 'workspace_id'),
      name: str(row, 'name'),
      description: str(row, 'description'),
      referenceAssetIds: json(row.reference_asset_ids_json, []),
      coverAssetId: nullable(row, 'cover_asset_id'),
      authorization: characterAuthorization(this.c, str(row, 'id'), num(row, 'reference_revision')),
      verification: {
        status: str(row, 'verification_status') as CharacterDto['verification']['status'],
        providerId: nullable(row, 'verification_provider_id'),
        expiresAt: nullable(row, 'verification_expires_at'),
      },
      createdBy: str(row, 'created_by'),
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at'),
      deletedAt: nullable(row, 'deleted_at'),
    };
  }
  characters(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'read');
    return this.c.page(
      'SELECT * FROM character_profiles WHERE workspace_id=? AND deleted_at IS NULL AND name LIKE ? ORDER BY updated_at DESC,id',
      [wid, `%${q.q ?? ''}%`],
      q,
      (r) => this.characterDto(r),
    );
  }
  getCharacter(actor: Actor, wid: string, cid: string): CharacterDto {
    this.c.requireAccess(actor, wid, 'read');
    return this.characterDto(this.c.resource('character_profiles', wid, cid));
  }
  createCharacter(actor: Actor, wid: string, raw: unknown): CharacterDto {
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      new EntitlementService(this.c).assertCreate(wid, 'characters');
      const input = CharacterInputSchema.parse(raw);
      this.images(wid, [
        ...input.referenceAssetIds,
        ...(input.coverAssetId ? [input.coverAssetId] : []),
      ]);
      const cid = id(),
        date = now();
      this.c.run(
        'INSERT INTO character_profiles(id,workspace_id,name,description,reference_asset_ids_json,cover_asset_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        cid,
        wid,
        input.name,
        input.description,
        JSON.stringify(input.referenceAssetIds),
        input.coverAssetId ?? input.referenceAssetIds[0] ?? null,
        actor.userId,
        date,
        date,
      );
      return this.getCharacter(actor, wid, cid);
    });
  }
  updateCharacter(actor: Actor, wid: string, cid: string, raw: unknown): CharacterDto {
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      const input = CharacterPatchSchema.parse(raw),
        old = this.getCharacter(actor, wid, cid),
        refs = input.referenceAssetIds ?? old.referenceAssetIds;
      this.images(wid, [...refs, ...(input.coverAssetId ? [input.coverAssetId] : [])]);
      const referenceChanged =
        input.referenceAssetIds !== undefined &&
        JSON.stringify(refs) !== JSON.stringify(old.referenceAssetIds);
      if (referenceChanged) {
        this.c.run(
          "UPDATE character_authorizations SET status='stale' WHERE character_id=? AND status='active'",
          cid,
        );
        this.c.run(
          "UPDATE identity_sessions SET status='expired',updated_at=? WHERE character_id=? AND status IN ('processing','active')",
          now(),
          cid,
        );
        this.c.run(
          'UPDATE character_profiles SET reference_revision=reference_revision+1 WHERE id=?',
          cid,
        );
      }
      this.c.run(
        'UPDATE character_profiles SET name=?,description=?,reference_asset_ids_json=?,cover_asset_id=?,verification_status=?,verification_provider_id=?,verification_expires_at=?,updated_at=? WHERE id=?',
        input.name ?? old.name,
        input.description ?? old.description,
        JSON.stringify(refs),
        input.coverAssetId === undefined
          ? input.referenceAssetIds
            ? (refs[0] ?? null)
            : old.coverAssetId
          : input.coverAssetId,
        referenceChanged ? 'unverified' : old.verification.status,
        referenceChanged ? null : old.verification.providerId,
        referenceChanged ? null : old.verification.expiresAt,
        now(),
        cid,
      );
      return this.getCharacter(actor, wid, cid);
    });
  }
  removeCharacter(actor: Actor, wid: string, cid: string) {
    this.c.requireAccess(actor, wid, 'write');
    this.getCharacter(actor, wid, cid);
    const date = now();
    this.c.run(
      'UPDATE character_profiles SET deleted_at=?,updated_at=? WHERE id=?',
      date,
      date,
      cid,
    );
    return { id: cid, deletedAt: date };
  }
  collections(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'read');
    return this.c.page(
      'SELECT * FROM collections WHERE workspace_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id',
      [wid],
      q,
      (r) => this.collectionDto(r),
    );
  }
  private collectionDto(r: Row) {
    return {
      id: str(r, 'id'),
      workspaceId: str(r, 'workspace_id'),
      name: str(r, 'name'),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
    };
  }
  createCollection(actor: Actor, wid: string, raw: unknown) {
    this.c.requireAccess(actor, wid, 'write');
    const { name } = inputs.WorkspaceInputSchema.parse(raw),
      cid = id(),
      date = now();
    this.c.run(
      'INSERT INTO collections VALUES (?,?,?,?,?,?,NULL)',
      cid,
      wid,
      name,
      actor.userId,
      date,
      date,
    );
    return this.collectionDto(this.c.resource('collections', wid, cid));
  }
  updateCollection(actor: Actor, wid: string, cid: string, raw: unknown) {
    this.c.requireAccess(actor, wid, 'write');
    this.c.resource('collections', wid, cid);
    const { name } = inputs.WorkspaceInputSchema.parse(raw);
    this.c.run('UPDATE collections SET name=?,updated_at=? WHERE id=?', name, now(), cid);
    return this.collectionDto(this.c.resource('collections', wid, cid));
  }
  removeCollection(actor: Actor, wid: string, cid: string) {
    this.c.requireAccess(actor, wid, 'write');
    this.c.resource('collections', wid, cid);
    const date = now();
    this.c.run('UPDATE collections SET deleted_at=?,updated_at=? WHERE id=?', date, date, cid);
    return { id: cid, deletedAt: date };
  }
  setCollectionAssets(actor: Actor, wid: string, cid: string, raw: unknown) {
    const input = inputs.SetCollectionAssetsInputSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      this.c.resource('collections', wid, cid);
      const ids = [...new Set(input.assetIds)];
      ids.forEach((aid) => this.c.resource('assets', wid, aid));
      this.c.run('DELETE FROM asset_collections WHERE collection_id=?', cid);
      ids.forEach((aid) => this.c.run('INSERT INTO asset_collections VALUES (?,?)', cid, aid));
      return { id: cid, assetIds: ids };
    });
  }
}
