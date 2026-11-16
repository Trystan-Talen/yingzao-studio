import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import {
  MODEL_CONNECTION_PROTOCOLS,
  modelConnectionInputSchema,
  modelDiscoveryInputSchema,
  type ModelConnectionDto,
  type ModelConnectionInput,
  type ModelConnectionKind,
  type ModelConnectionProtocol,
  type ModelDiscoveryStatus,
  type ModelDiscoveryInput,
  type ModelDirectoryDto,
  type ModelFallbackResourceDto,
} from '../../contracts/model-connections';
import type { AppConfig } from '../config';
import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import { isPublicAddress } from '../providers/http';

export interface RuntimeModelConnection {
  id: string;
  name?: string;
  kind: ModelConnectionKind;
  protocol: ModelConnectionProtocol;
  baseUrl: string;
  model: string;
  visionModel?: string;
  secret: string;
  revision: string;
  /** Stable endpoint/model identity for polling; same-resource credential rotation remains possible. */
  executionRevision?: string;
  fallbackResources?: RuntimeModelConnection[];
}
interface ConnectionRow {
  kind: ModelConnectionKind;
  protocol: ModelConnectionProtocol;
  base_url: string;
  models_url: string;
  model: string;
  vision_model: string;
  encrypted_secret: string | null;
  key_hint: string | null;
  enabled: number;
  revision: string;
  updated_at: string;
  models_json: string;
  models_checked_at: string | null;
  discovery_status: ModelDiscoveryStatus;
}
interface ResourceRow extends ConnectionRow {
  id: string;
  name: string;
  priority: number;
}
const kinds: ModelConnectionKind[] = ['text', 'image', 'video'];
export function modelConnectionsRevision(
  db: DatabaseContext,
  wid: string,
  operation: string,
  planningMode?: 'assisted' | 'direct',
): string {
  const required =
    operation === 'text.assist'
      ? ['text']
      : operation === 'video.generate'
        ? kinds
        : ['text', 'image'];
  return createHash('sha256')
    .update(
      JSON.stringify(
        required
          .filter((kind) => planningMode !== 'direct' || kind !== 'text')
          .map((kind) => {
            const saved = db.sqlite
              .prepare(
                'SELECT revision,enabled FROM model_connections WHERE workspace_id=? AND kind=?',
              )
              .get(wid, kind) as { revision: string; enabled: number } | undefined;
            return [kind, saved?.revision || null, saved?.enabled || 0];
          }),
      ),
    )
    .digest('hex');
}
const messages: Record<ModelDiscoveryStatus, string> = {
  never: '尚未读取模型目录。手动填写模型后也可使用；生成效果需另行验证。',
  connected: '已读取模型目录；目录不证明模型类型、参数或生成质量。',
  unavailable: '无法读取模型目录，请检查地址；也可以手动填写模型。',
  unauthorized: '模型目录拒绝访问，请检查密钥与目录权限。',
  invalid: '模型目录格式不兼容，请手动填写模型。',
};
export function validateModelServiceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, 'MODEL_SERVICE_URL_INVALID', '请填写完整服务地址。');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    !host.includes('.') ||
    (isIP(host) && !isPublicAddress(host))
  )
    throw new AppError(
      400,
      'MODEL_SERVICE_URL_INVALID',
      '服务地址须为公开 HTTPS（安全超文本传输协议）地址，不能包含凭据、查询参数或非标准端口。',
    );
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}
function connectionUrl(input: Pick<ModelDiscoveryInput, 'kind' | 'baseUrl' | 'modelsUrl'>) {
  const url = validateModelServiceUrl(input.baseUrl);
  if (input.kind !== 'video' && url.hostname === 'xingyunyinli.com' && url.pathname === '/')
    url.pathname = '/v1';
  if (input.kind === 'video' && !url.pathname.endsWith('/api/v3/contents/generations/tasks'))
    throw new AppError(
      400,
      'MODEL_PROTOCOL_URL_INVALID',
      '视频服务请填写完整的原生任务集合地址，以 /api/v3/contents/generations/tasks 结尾。',
    );
  if (input.modelsUrl && validateModelServiceUrl(input.modelsUrl).origin !== url.origin)
    throw new AppError(
      400,
      'MODEL_DIRECTORY_ORIGIN_INVALID',
      '模型目录必须与服务地址同源，避免将密钥发送到其他站点。',
    );
  return url;
}
class DiscoveryError extends Error {
  constructor(readonly status: Exclude<ModelDiscoveryStatus, 'never' | 'connected'>) {
    super(status);
  }
}
/** Read-only, deadline/size bounded, DNS-pinned request. Never follow redirects with a key. */
export async function discoverConnectionModels(url: URL, secret: string): Promise<string[]> {
  const signal = AbortSignal.timeout(8000);
  try {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(hostname);
    const addresses = family
      ? [{ address: hostname, family }]
      : await Promise.race([
          lookup(hostname, { all: true }),
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DiscoveryError('unavailable')), {
              once: true,
            });
          }),
        ]);
    if (signal.aborted || !addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
      throw new DiscoveryError('unavailable');
    const pinned = addresses[0]!;
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          signal,
          timeout: 8000,
          headers: { Accept: 'application/json', Authorization: `Bearer ${secret}` },
          lookup: (_hostname, options, callback) => {
            if (typeof options === 'object' && options.all) callback(null, [pinned]);
            else callback(null, pinned.address, pinned.family);
          },
        },
        (res) => {
          res.on('error', () => reject(new DiscoveryError('unavailable')));
          if (res.statusCode !== 200) {
            res.destroy();
            reject(
              new DiscoveryError(
                [401, 403].includes(res.statusCode || 0) ? 'unauthorized' : 'unavailable',
              ),
            );
            return;
          }
          const limit = 2 * 1024 * 1024;
          if (Number(res.headers['content-length'] || 0) > limit) {
            res.destroy();
            reject(new DiscoveryError('invalid'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
              reject(new DiscoveryError('invalid'));
              res.destroy();
            } else chunks.push(chunk);
          });
          res.on('end', () => resolve(Buffer.concat(chunks)));
        },
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => reject(new DiscoveryError('unavailable')));
      req.end();
    });
    const body: unknown = JSON.parse(bytes.toString('utf8'));
    if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data))
      throw new DiscoveryError('invalid');
    if (body.data.length > 10000) throw new DiscoveryError('invalid');
    const ids = body.data.map((entry: unknown) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        !('id' in entry) ||
        typeof entry.id !== 'string' ||
        !/^[^\s\u0000-\u001f\u007f]{1,120}$/.test(entry.id)
      )
        throw new DiscoveryError('invalid');
      return entry.id;
    });
    return [...new Set(ids)].sort();
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    throw new DiscoveryError(error instanceof SyntaxError ? 'invalid' : 'unavailable');
  }
}

export function createModelConnectionsService(
  db: DatabaseContext,
  config: AppConfig,
  discover = discoverConnectionModels,
) {
  const key = createHash('sha256').update(config.encryptionKey).digest();
  const sql = db.sqlite;
  function encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((v) => v.toString('base64')).join('.');
  }
  function decrypt(value: string) {
    try {
      const [iv, tag, data] = value.split('.');
      if (!iv || !tag || !data) throw new Error('INVALID');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new AppError(
        500,
        'MODEL_CONNECTION_KEY_INVALID',
        '模型配置密钥无法解密，请重新保存密钥。',
      );
    }
  }
  function row(wid: string, kind: ModelConnectionKind) {
    return sql
      .prepare('SELECT * FROM model_connections WHERE workspace_id=? AND kind=?')
      .get(wid, kind) as ConnectionRow | undefined;
  }
  function resourceRow(wid: string, kind: ModelConnectionKind, id: string) {
    return sql
      .prepare('SELECT * FROM model_connection_resources WHERE workspace_id=? AND kind=? AND id=?')
      .get(wid, kind, id) as ResourceRow | undefined;
  }
  function resources(wid: string, kind: ModelConnectionKind) {
    return sql
      .prepare(
        'SELECT * FROM model_connection_resources WHERE workspace_id=? AND kind=? ORDER BY priority,id',
      )
      .all(wid, kind) as ResourceRow[];
  }
  function dto(kind: ModelConnectionKind, saved?: ConnectionRow): ModelConnectionDto {
    const status = saved?.discovery_status || 'never';
    return {
      kind,
      protocol: saved?.protocol || MODEL_CONNECTION_PROTOCOLS[kind],
      baseUrl:
        saved?.base_url ||
        (kind === 'video'
          ? 'https://xingyunyinli.com/doubao/api/v3/contents/generations/tasks'
          : 'https://xingyunyinli.com/v1'),
      modelsUrl:
        saved?.models_url ||
        (kind === 'video' && !saved ? 'https://xingyunyinli.com/v1/models' : ''),
      model: saved?.model || '',
      visionModel: saved?.vision_model || '',
      enabled: saved?.enabled === 1,
      configured: Boolean(saved?.encrypted_secret),
      keyHint: saved?.key_hint || null,
      revision: saved?.revision || null,
      updatedAt: saved?.updated_at || null,
      models: saved ? (JSON.parse(saved.models_json) as string[]) : [],
      modelsCheckedAt: saved?.models_checked_at || null,
      discoveryStatus: status,
      discoveryMessage:
        kind === 'video' && saved && !saved.models_url && status === 'unavailable'
          ? '该视频协议没有统一模型目录，请填写目录地址或手动指定模型。'
          : messages[status],
    };
  }
  function get(wid: string, kind: ModelConnectionKind): ModelConnectionDto {
    return {
      ...dto(kind, row(wid, kind)),
      fallbackResources: resources(wid, kind).map((saved): ModelFallbackResourceDto => ({
        ...dto(kind, saved),
        id: saved.id,
        name: saved.name,
      })),
    };
  }
  function runtimeResource(
    saved: ConnectionRow,
    id: string,
    name?: string,
  ): RuntimeModelConnection | undefined {
    if (!saved.enabled || !saved.encrypted_secret) return undefined;
    const secret = decrypt(saved.encrypted_secret);
    return {
      id,
      ...(name ? { name } : {}),
      kind: saved.kind,
      protocol: saved.protocol,
      baseUrl: saved.base_url,
      model: saved.model,
      visionModel: saved.vision_model || '',
      secret,
      revision: saved.revision,
      executionRevision: createHmac('sha256', key)
        .update(JSON.stringify([saved.protocol, saved.base_url, saved.model]))
        .digest('hex'),
    };
  }
  function runtime(wid: string, kind: ModelConnectionKind): RuntimeModelConnection | undefined {
    const saved = row(wid, kind);
    if (!saved?.enabled || !saved.encrypted_secret) return undefined;
    const active = runtimeResource(saved, kind)!;
    active.fallbackResources = resources(wid, kind).flatMap((resource) => {
      const item = runtimeResource(resource, resource.id, resource.name);
      return item ? [item] : [];
    });
    return active;
  }
  function revision(wid: string, operation: string, planningMode?: 'assisted' | 'direct'): string {
    return modelConnectionsRevision(db, wid, operation, planningMode);
  }
  function update(wid: string, raw: ModelConnectionInput) {
    const input = modelConnectionInputSchema.parse(raw);
    const url = connectionUrl(input);
    const baseUrl = url.href.replace(/\/$/, '');
    const previous = row(wid, input.kind);
    const encrypted = input.removeSecret
      ? null
      : input.secret
        ? encrypt(input.secret)
        : previous?.encrypted_secret || null;
    // Moving a saved key to another host requires an explicit replacement key.
    if (
      previous &&
      new URL(previous.base_url).origin !== url.origin &&
      encrypted &&
      !input.secret &&
      !input.removeSecret
    )
      throw new AppError(400, 'MODEL_CONNECTION_KEY_REQUIRED', '更换服务站点时请重新填写密钥。');
    const hint = input.removeSecret
      ? null
      : input.secret
        ? input.secret.length >= 8
          ? `…${input.secret.slice(-4)}`
          : '已设置'
        : previous?.key_hint || null;
    const backups = input.fallbackResources?.map((resource, priority) => {
      const resourceUrl = connectionUrl({ ...resource, kind: input.kind });
      const old = resourceRow(wid, input.kind, resource.id);
      if (
        old &&
        new URL(old.base_url).origin !== resourceUrl.origin &&
        old.encrypted_secret &&
        !resource.secret &&
        !resource.removeSecret
      )
        throw new AppError(
          400,
          'MODEL_CONNECTION_KEY_REQUIRED',
          '更换备用资源站点时请重新填写该资源密钥。',
        );
      return { resource, priority, baseUrl: resourceUrl.href.replace(/\/$/, ''), old };
    });
    sql.transaction(() => {
      sql
        .prepare(
          `INSERT INTO model_connections(workspace_id,kind,protocol,base_url,models_url,model,vision_model,encrypted_secret,key_hint,enabled,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,kind) DO UPDATE SET protocol=excluded.protocol,base_url=excluded.base_url,models_url=excluded.models_url,model=excluded.model,vision_model=excluded.vision_model,encrypted_secret=excluded.encrypted_secret,key_hint=excluded.key_hint,enabled=excluded.enabled,revision=excluded.revision,updated_at=excluded.updated_at,models_json='[]',models_checked_at=NULL,discovery_status='never'`,
        )
        .run(
          wid,
          input.kind,
          input.protocol,
          baseUrl,
          input.modelsUrl,
          input.model,
          input.kind === 'text' ? (input.visionModel ?? previous?.vision_model ?? '') : '',
          encrypted,
          hint,
          input.enabled ? 1 : 0,
          randomUUID(),
          new Date().toISOString(),
        );
      if (backups) {
        for (const { resource, priority, baseUrl: resourceBaseUrl, old } of backups) {
          const resourceEncrypted = resource.removeSecret
            ? null
            : resource.secret
              ? encrypt(resource.secret)
              : old?.encrypted_secret || null;
          const resourceHint = resource.removeSecret
            ? null
            : resource.secret
              ? resource.secret.length >= 8
                ? `…${resource.secret.slice(-4)}`
                : '已设置'
              : old?.key_hint || null;
          sql
            .prepare(
              `INSERT INTO model_connection_resources(workspace_id,kind,id,name,priority,protocol,base_url,models_url,model,vision_model,encrypted_secret,key_hint,enabled,revision,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(workspace_id,kind,id) DO UPDATE SET name=excluded.name,priority=excluded.priority,protocol=excluded.protocol,base_url=excluded.base_url,models_url=excluded.models_url,model=excluded.model,vision_model=excluded.vision_model,encrypted_secret=excluded.encrypted_secret,key_hint=excluded.key_hint,enabled=excluded.enabled,revision=excluded.revision,updated_at=excluded.updated_at,models_json='[]',models_checked_at=NULL,discovery_status='never'`,
            )
            .run(
              wid,
              input.kind,
              resource.id,
              resource.name,
              priority,
              resource.protocol,
              resourceBaseUrl,
              resource.modelsUrl,
              resource.model,
              input.kind === 'text' ? (resource.visionModel ?? old?.vision_model ?? '') : '',
              resourceEncrypted,
              resourceHint,
              resource.enabled ? 1 : 0,
              randomUUID(),
              new Date().toISOString(),
            );
        }
        const kept = new Set(backups.map(({ resource }) => resource.id));
        for (const old of resources(wid, input.kind))
          if (!kept.has(old.id))
            sql
              .prepare(
                'DELETE FROM model_connection_resources WHERE workspace_id=? AND kind=? AND id=?',
              )
              .run(wid, input.kind, old.id);
      }
    })();
    return get(wid, input.kind);
  }
  async function previewModels(wid: string, raw: ModelDiscoveryInput): Promise<ModelDirectoryDto> {
    const input = modelDiscoveryInputSchema.parse(raw);
    const baseUrl = connectionUrl(input);
    const saved = input.resourceId
      ? resourceRow(wid, input.kind, input.resourceId)
      : row(wid, input.kind);
    if (!input.secret && saved && new URL(saved.base_url).origin !== baseUrl.origin)
      throw new AppError(400, 'MODEL_CONNECTION_KEY_REQUIRED', '更换服务站点时请重新填写密钥。');
    const secret = input.secret || (saved?.encrypted_secret ? decrypt(saved.encrypted_secret) : '');
    if (!secret) throw new AppError(400, 'MODEL_CONNECTION_MISSING', '请先填写服务地址与密钥。');
    let status: ModelDiscoveryStatus = 'connected';
    let models: string[] = [];
    const missingVideoDirectory = input.kind === 'video' && !input.modelsUrl;
    if (missingVideoDirectory) status = 'unavailable';
    else {
      const url = validateModelServiceUrl(
        input.modelsUrl || `${baseUrl.href.replace(/\/$/, '')}/models`,
      );
      try {
        models = await discover(url, secret);
      } catch (error) {
        status = error instanceof DiscoveryError ? error.status : 'unavailable';
      }
    }
    // A draft lookup never saves credentials, changes the active model or mutates its revision.
    return {
      models,
      modelsCheckedAt: new Date().toISOString(),
      discoveryStatus: status,
      discoveryMessage: missingVideoDirectory
        ? '该视频协议没有统一模型目录，请填写目录地址或手动指定模型。'
        : messages[status],
    };
  }
  async function refreshModels(wid: string, kind: ModelConnectionKind, resourceId?: string) {
    const saved = resourceId ? resourceRow(wid, kind, resourceId) : row(wid, kind);
    if (!saved?.encrypted_secret)
      throw new AppError(400, 'MODEL_CONNECTION_MISSING', '请先保存服务地址与密钥。');
    const table = resourceId ? 'model_connection_resources' : 'model_connections';
    const condition = resourceId ? ' AND id=?' : '';
    const identity = resourceId
      ? [wid, kind, saved.revision, resourceId]
      : [wid, kind, saved.revision];
    if (kind === 'video' && !saved.models_url) {
      sql
        .prepare(
          `UPDATE ${table} SET models_json='[]',models_checked_at=?,discovery_status='unavailable' WHERE workspace_id=? AND kind=? AND revision=?${condition}`,
        )
        .run(new Date().toISOString(), ...identity);
      return get(wid, kind);
    }
    const url = validateModelServiceUrl(saved.models_url || `${saved.base_url}/models`);
    let status: ModelDiscoveryStatus = 'connected';
    let models: string[] = [];
    try {
      models = await discover(url, decrypt(saved.encrypted_secret));
    } catch (error) {
      status = error instanceof DiscoveryError ? error.status : 'unavailable';
    }
    const result = sql
      .prepare(
        `UPDATE ${table} SET models_json=?,models_checked_at=?,discovery_status=? WHERE workspace_id=? AND kind=? AND revision=?${condition}`,
      )
      .run(JSON.stringify(models), new Date().toISOString(), status, ...identity);
    if (!result.changes)
      throw new AppError(
        409,
        'MODEL_CONNECTION_CHANGED',
        '模型配置已被修改，请刷新后重新读取目录。',
      );
    return get(wid, kind);
  }
  return {
    get,
    list: (wid: string) => kinds.map((kind) => get(wid, kind)),
    runtime,
    revision,
    update,
    previewModels,
    refreshModels,
  };
}
