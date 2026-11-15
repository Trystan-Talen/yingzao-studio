import type { Actor, Page } from '../../contracts/core';
import {
  MemoryInputSchema,
  MemoryPatchSchema,
  ProductInputSchema,
  ProductPatchSchema,
  type MemoryDto,
  type MemoryInput,
  type ProductDto,
  type ProductInput,
} from '../../contracts/knowledge';
import { AppError } from '../errors';
import { ReferenceService } from './references';
import {
  type CoreContext,
  type ListQuery,
  type Row,
  id,
  json,
  now,
  nullable,
  num,
  str,
} from './shared';

export class KnowledgeService {
  constructor(private c: CoreContext) {}

  private memoryAccess(actor: Actor, wid: string) {
    if (actor.authType !== 'session')
      throw new AppError(403, 'FORBIDDEN', '个人创作记忆仅支持本人账户会话');
    this.c.requireAccess(actor, wid, 'read');
  }
  private memoryRow(actor: Actor, wid: string, mid: string): Row {
    this.memoryAccess(actor, wid);
    const row = this.c.get(
      'SELECT * FROM creative_memories WHERE id=? AND workspace_id=? AND user_id=?',
      mid,
      wid,
      actor.userId,
    );
    if (!row) throw new AppError(404, 'NOT_FOUND', '创作记忆不存在');
    return row;
  }
  private memoryDto(row: Row): MemoryDto {
    const kind = str(row, 'kind') as MemoryDto['kind'];
    const expiresAt = nullable(row, 'expires_at');
    const halfLifeDays = row.half_life_days === null ? null : num(row, 'half_life_days');
    const confirmedAt = str(row, 'confirmed_at');
    const active = row.status === 'active' && (!expiresAt || Date.parse(expiresAt) > Date.now());
    const ageDays = Math.max(0, Date.now() - Date.parse(confirmedAt)) / 86400000;
    const effectiveWeight = !active
      ? 0
      : kind === 'preference'
        ? Math.pow(0.5, ageDays / (halfLifeDays ?? 90))
        : 1;
    return {
      id: str(row, 'id'),
      workspaceId: str(row, 'workspace_id'),
      userId: str(row, 'user_id'),
      topic: str(row, 'topic'),
      content: str(row, 'content'),
      kind,
      mediaType: str(row, 'media_type') as MemoryDto['mediaType'],
      expiresAt,
      halfLifeDays,
      status: str(row, 'status') as MemoryDto['status'],
      version: num(row, 'version'),
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at'),
      confirmedAt,
      effectiveWeight,
      eligible: active && effectiveWeight >= 0.25,
    };
  }
  private memoryValues(input: MemoryInput, allowExpired = false): MemoryInput {
    if (
      !allowExpired &&
      input.kind === 'temporary' &&
      (!input.expiresAt || Date.parse(input.expiresAt) <= Date.now())
    )
      throw new AppError(400, 'MEMORY_EXPIRY_REQUIRED', '临时记忆必须设置未来的到期时间');
    return {
      ...input,
      halfLifeDays: input.kind === 'preference' ? (input.halfLifeDays ?? 90) : null,
    };
  }
  private uniqueMemory(actor: Actor, wid: string, input: MemoryInput, except = '') {
    if (
      this.c
        .all(
          'SELECT topic FROM creative_memories WHERE workspace_id=? AND user_id=? AND media_type=? AND id<>?',
          wid,
          actor.userId,
          input.mediaType,
          except,
        )
        .some((row) => str(row, 'topic').toLowerCase() === input.topic.toLowerCase())
    )
      throw new AppError(409, 'MEMORY_TOPIC_EXISTS', '此用途下已有同主题记忆，请编辑已有记录');
  }
  listMemories(actor: Actor, wid: string, query: ListQuery = {}): Page<MemoryDto> {
    this.memoryAccess(actor, wid);
    return this.c.page(
      'SELECT * FROM creative_memories WHERE workspace_id=? AND user_id=? AND (topic LIKE ? OR content LIKE ?) ORDER BY updated_at DESC,id',
      [wid, actor.userId, `%${query.q ?? ''}%`, `%${query.q ?? ''}%`],
      query,
      (row) => this.memoryDto(row),
    );
  }
  getMemory(actor: Actor, wid: string, mid: string): MemoryDto {
    return this.memoryDto(this.memoryRow(actor, wid, mid));
  }
  createMemory(actor: Actor, wid: string, raw: unknown): MemoryDto {
    const input = this.memoryValues(MemoryInputSchema.parse(raw));
    return this.c.transaction(() => {
      this.memoryAccess(actor, wid);
      this.uniqueMemory(actor, wid, input);
      const count =
        this.c.get<{ n: number }>(
          'SELECT COUNT(*) n FROM creative_memories WHERE workspace_id=? AND user_id=?',
          wid,
          actor.userId,
        )?.n ?? 0;
      if (count >= 100)
        throw new AppError(409, 'MEMORY_LIMIT', '最多保存100条个人创作记忆，请先整理已有记录');
      const mid = id(),
        at = now();
      this.c.run(
        'INSERT INTO creative_memories(id,workspace_id,user_id,topic,content,kind,media_type,expires_at,half_life_days,status,version,created_at,updated_at,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?)',
        mid,
        wid,
        actor.userId,
        input.topic,
        input.content,
        input.kind,
        input.mediaType,
        input.expiresAt,
        input.halfLifeDays,
        input.status,
        at,
        at,
        at,
      );
      return this.getMemory(actor, wid, mid);
    });
  }
  updateMemory(actor: Actor, wid: string, mid: string, raw: unknown): MemoryDto {
    const { expectedVersion, ...fields } = MemoryPatchSchema.parse(raw);
    return this.c.transaction(() => {
      const old = this.memoryRow(actor, wid, mid);
      const previous = this.memoryDto(old);
      if (num(old, 'version') !== expectedVersion)
        throw new AppError(409, 'KNOWLEDGE_VERSION_CONFLICT', '记录已被修改，请刷新后再保存', {
          current: previous,
        });
      const merged = MemoryInputSchema.parse({
        topic: previous.topic,
        content: previous.content,
        kind: previous.kind,
        mediaType: previous.mediaType,
        expiresAt: previous.expiresAt,
        halfLifeDays:
          fields.kind !== undefined && fields.kind !== previous.kind ? null : previous.halfLifeDays,
        status: previous.status,
        ...fields,
      });
      const normalized = this.memoryValues(merged, true);
      const onlyPausing =
        previous.status === 'active' &&
        normalized.status === 'paused' &&
        (['topic', 'content', 'kind', 'mediaType', 'expiresAt', 'halfLifeDays'] as const).every(
          (key) => normalized[key] === previous[key],
        );
      const input = this.memoryValues(normalized, onlyPausing);
      this.uniqueMemory(actor, wid, input, mid);
      const at = now();
      this.c.run(
        'UPDATE creative_memories SET topic=?,content=?,kind=?,media_type=?,expires_at=?,half_life_days=?,status=?,version=version+1,updated_at=?,confirmed_at=? WHERE id=? AND version=?',
        input.topic,
        input.content,
        input.kind,
        input.mediaType,
        input.expiresAt,
        input.halfLifeDays,
        input.status,
        at,
        onlyPausing ? previous.confirmedAt : at,
        mid,
        expectedVersion,
      );
      return this.getMemory(actor, wid, mid);
    });
  }
  removeMemory(actor: Actor, wid: string, mid: string) {
    return this.c.transaction(() => {
      this.memoryRow(actor, wid, mid);
      this.c.run('DELETE FROM creative_memories WHERE id=?', mid);
      return { id: mid, deleted: true };
    });
  }
  resolveMemories(
    actor: Actor,
    wid: string,
    mediaType: 'image' | 'video',
  ): { items: MemoryDto[]; omitted: number } {
    this.c.requireAccess(actor, wid, 'read');
    if (actor.authType !== 'session') return { items: [], omitted: 0 };
    const eligible = this.c
      .all(
        "SELECT * FROM creative_memories WHERE workspace_id=? AND user_id=? AND media_type IN ('all',?)",
        wid,
        actor.userId,
        mediaType,
      )
      .map((row) => this.memoryDto(row))
      .filter((memory) => memory.eligible);
    // SQLite's NOCASE only folds ASCII. Keep older Unicode-case duplicates stored,
    // but select one current record per topic using the same comparison as writes.
    const topics = new Map<string, MemoryDto>();
    for (const memory of [...eligible].sort(
      (a, b) =>
        Number(b.mediaType === mediaType) - Number(a.mediaType === mediaType) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.id.localeCompare(a.id),
    )) {
      const topic = memory.topic.toLowerCase();
      if (!topics.has(topic)) topics.set(topic, memory);
    }
    const ranked = [...topics.values()].sort(
      (a, b) =>
        ({ temporary: 0, preference: 1, profile: 2 })[a.kind] -
          { temporary: 0, preference: 1, profile: 2 }[b.kind] ||
        b.effectiveWeight - a.effectiveWeight ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
    const items: MemoryDto[] = [];
    let size = 0;
    for (const memory of ranked) {
      const length = memory.topic.length + memory.content.length;
      if (items.length >= 8 || size + length > 6000) continue;
      items.push(memory);
      size += length;
    }
    return { items, omitted: eligible.length - items.length };
  }

  private productDto(row: Row): ProductDto {
    return {
      id: str(row, 'id'),
      workspaceId: str(row, 'workspace_id'),
      name: str(row, 'name'),
      description: str(row, 'description'),
      facts: json(row.facts_json, []),
      cautions: json(row.cautions_json, []),
      brandId: nullable(row, 'brand_id'),
      referenceAssetIds: json(row.reference_asset_ids_json, []),
      visibility: str(row, 'visibility') as ProductDto['visibility'],
      validUntil: nullable(row, 'valid_until'),
      version: num(row, 'version'),
      createdBy: str(row, 'created_by'),
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at'),
      deletedAt: nullable(row, 'deleted_at'),
    };
  }
  private productRow(actor: Actor, wid: string, pid: string, includeDeleted = false): Row {
    this.c.requireAccess(actor, wid, 'read');
    const row = this.c.get(
      `SELECT p.* FROM products p WHERE p.id=? AND p.workspace_id=? ${includeDeleted ? '' : 'AND p.deleted_at IS NULL'} AND (p.visibility='workspace' OR p.created_by=?) AND (p.created_by=? OR p.brand_id IS NULL OR EXISTS(SELECT 1 FROM brands b WHERE b.id=p.brand_id AND b.workspace_id=p.workspace_id AND b.deleted_at IS NULL AND (b.visibility='workspace' OR b.created_by=?)))`,
      pid,
      wid,
      actor.userId,
      actor.userId,
      actor.userId,
    );
    if (!row) throw new AppError(404, 'NOT_FOUND', '产品不存在或关联品牌不可访问');
    return row;
  }
  private productReferences(actor: Actor, wid: string, input: ProductInput) {
    if (input.brandId) {
      const brand = new ReferenceService(this.c).getBrand(actor, wid, input.brandId);
      if (input.visibility === 'workspace' && brand.visibility === 'private')
        throw new AppError(400, 'PRODUCT_BRAND_PRIVATE', '关联私有品牌的产品也必须设为私有');
    }
    for (const aid of input.referenceAssetIds) {
      const asset = this.c.resource('assets', wid, aid);
      if (asset.kind !== 'image')
        throw new AppError(400, 'IMAGE_REQUIRED', '产品参考素材必须是图片');
    }
  }
  listProducts(actor: Actor, wid: string, query: ListQuery = {}): Page<ProductDto> {
    this.c.requireAccess(actor, wid, 'read');
    return this.c.page(
      `SELECT p.* FROM products p WHERE p.workspace_id=? AND p.deleted_at IS ${query.deleted ? 'NOT NULL' : 'NULL'} AND (p.visibility='workspace' OR p.created_by=?) AND (p.created_by=? OR p.brand_id IS NULL OR EXISTS(SELECT 1 FROM brands b WHERE b.id=p.brand_id AND b.workspace_id=p.workspace_id AND b.deleted_at IS NULL AND (b.visibility='workspace' OR b.created_by=?))) AND (p.name LIKE ? OR p.description LIKE ?) ORDER BY p.updated_at DESC,p.id`,
      [wid, actor.userId, actor.userId, actor.userId, `%${query.q ?? ''}%`, `%${query.q ?? ''}%`],
      query,
      (row) => this.productDto(row),
    );
  }
  getProduct(actor: Actor, wid: string, pid: string): ProductDto {
    return this.productDto(this.productRow(actor, wid, pid));
  }
  createProduct(actor: Actor, wid: string, raw: unknown): ProductDto {
    const input = ProductInputSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      this.productReferences(actor, wid, input);
      const pid = id(),
        at = now();
      this.c.run(
        'INSERT INTO products(id,workspace_id,name,description,facts_json,cautions_json,brand_id,reference_asset_ids_json,visibility,valid_until,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?)',
        pid,
        wid,
        input.name,
        input.description,
        JSON.stringify(input.facts),
        JSON.stringify(input.cautions),
        input.brandId,
        JSON.stringify(input.referenceAssetIds),
        input.visibility,
        input.validUntil,
        actor.userId,
        at,
        at,
      );
      this.c.audit(actor, wid, 'product.create', 'product', pid);
      return this.getProduct(actor, wid, pid);
    });
  }
  updateProduct(actor: Actor, wid: string, pid: string, raw: unknown): ProductDto {
    const { expectedVersion, ...fields } = ProductPatchSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      // Recycled records remain editable so broken references can be repaired before restore.
      const old = this.productRow(actor, wid, pid, true);
      const previous = this.productDto(old);
      if (num(old, 'version') !== expectedVersion)
        throw new AppError(409, 'KNOWLEDGE_VERSION_CONFLICT', '记录已被修改，请刷新后再保存', {
          current: previous,
        });
      const input = ProductInputSchema.parse({
        name: previous.name,
        description: previous.description,
        facts: previous.facts,
        cautions: previous.cautions,
        brandId: previous.brandId,
        referenceAssetIds: previous.referenceAssetIds,
        visibility: previous.visibility,
        validUntil: previous.validUntil,
        ...fields,
      });
      if (input.visibility === 'private' && previous.createdBy !== actor.userId)
        throw new AppError(
          403,
          'PRODUCT_VISIBILITY_FORBIDDEN',
          '只有产品创建者可以将共享产品设为私有',
        );
      this.productReferences(actor, wid, input);
      this.c.run(
        'UPDATE products SET name=?,description=?,facts_json=?,cautions_json=?,brand_id=?,reference_asset_ids_json=?,visibility=?,valid_until=?,version=version+1,updated_at=? WHERE id=? AND version=?',
        input.name,
        input.description,
        JSON.stringify(input.facts),
        JSON.stringify(input.cautions),
        input.brandId,
        JSON.stringify(input.referenceAssetIds),
        input.visibility,
        input.validUntil,
        now(),
        pid,
        expectedVersion,
      );
      this.c.audit(actor, wid, 'product.update', 'product', pid, { version: expectedVersion + 1 });
      return this.productDto(this.productRow(actor, wid, pid, true));
    });
  }
  removeProduct(actor: Actor, wid: string, pid: string) {
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      this.productRow(actor, wid, pid);
      const at = now();
      this.c.run(
        'UPDATE products SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?',
        at,
        at,
        pid,
      );
      this.c.audit(actor, wid, 'product.delete', 'product', pid);
      return { id: pid, deletedAt: at };
    });
  }
  restoreProduct(actor: Actor, wid: string, pid: string): ProductDto {
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      const product = this.productDto(this.productRow(actor, wid, pid, true));
      this.productReferences(actor, wid, product);
      if (product.deletedAt) {
        this.c.run(
          'UPDATE products SET deleted_at=NULL,updated_at=?,version=version+1 WHERE id=?',
          now(),
          pid,
        );
        this.c.audit(actor, wid, 'product.restore', 'product', pid);
      }
      return this.getProduct(actor, wid, pid);
    });
  }
}
