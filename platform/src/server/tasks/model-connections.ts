import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import {
  MODEL_CONNECTION_PROTOCOLS,
  modelConnectionInputSchema,
  type ModelConnectionDto,
  type ModelConnectionInput,
  type ModelConnectionKind,
  type ModelConnectionProtocol,
  type ModelDiscoveryStatus,
} from '../../contracts/model-connections';
import type { AppConfig } from '../config';
import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import { isPublicAddress } from '../providers/http';

export interface RuntimeModelConnection {
  id: ModelConnectionKind;
  kind: ModelConnectionKind;
  protocol: ModelConnectionProtocol;
  baseUrl: string;
  model: string;
  visionModel?: string;
  secret: string;
  revision: string;
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
const kinds: ModelConnectionKind[] = ['text', 'image', 'video'];
export function modelConnectionsRevision(
  db: DatabaseContext,
  wid: string,
  operation: string,
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
        required.map((kind) => {
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
  function get(wid: string, kind: ModelConnectionKind): ModelConnectionDto {
    const saved = row(wid, kind);
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
  function runtime(wid: string, kind: ModelConnectionKind): RuntimeModelConnection | undefined {
    const saved = row(wid, kind);
    if (!saved?.enabled || !saved.encrypted_secret) return undefined;
    return {
      id: kind,
      kind,
      protocol: saved.protocol,
      baseUrl: saved.base_url,
      model: saved.model,
      visionModel: saved.vision_model || '',
      secret: decrypt(saved.encrypted_secret),
      revision: saved.revision,
    };
  }
  function revision(wid: string, operation: string): string {
    return modelConnectionsRevision(db, wid, operation);
  }
  function update(wid: string, raw: ModelConnectionInput) {
    const input = modelConnectionInputSchema.parse(raw);
    const url = validateModelServiceUrl(input.baseUrl);
    if (input.kind !== 'video' && url.hostname === 'xingyunyinli.com' && url.pathname === '/')
      url.pathname = '/v1';
    const baseUrl = url.href.replace(/\/$/, '');
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
    return get(wid, input.kind);
  }
  async function refreshModels(wid: string, kind: ModelConnectionKind) {
    const saved = row(wid, kind);
    if (!saved?.encrypted_secret)
      throw new AppError(400, 'MODEL_CONNECTION_MISSING', '请先保存服务地址与密钥。');
    if (kind === 'video' && !saved.models_url) {
      sql
        .prepare(
          "UPDATE model_connections SET models_json='[]',models_checked_at=?,discovery_status='unavailable' WHERE workspace_id=? AND kind=? AND revision=?",
        )
        .run(new Date().toISOString(), wid, kind, saved.revision);
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
        'UPDATE model_connections SET models_json=?,models_checked_at=?,discovery_status=? WHERE workspace_id=? AND kind=? AND revision=?',
      )
      .run(JSON.stringify(models), new Date().toISOString(), status, wid, kind, saved.revision);
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
    refreshModels,
  };
}
