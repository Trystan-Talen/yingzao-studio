import type { BrandDto, AssetDto } from '../../contracts/core';
import { useApi } from '../lib/api';
import { getLocale, t } from '../lib/i18n';
import { Button, Notice } from './ui';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Only explicitly changed draft fields replace the latest record. */
export function mergeKnowledgeInput<T extends object>(base: T, draft: T, latest: T): T {
  return Object.fromEntries(
    (Object.keys(base) as (keyof T)[]).map((key) => [
      key,
      same(base[key], draft[key]) ? latest[key] : draft[key],
    ]),
  ) as T;
}

const labels: Record<string, string> = {
  topic: '记忆主题',
  content: '记忆内容',
  kind: '记忆类型',
  mediaType: '适用创作',
  expiresAt: '到期时间',
  halfLifeDays: '半衰期（天）',
  status: '记忆状态',
  name: '产品名称',
  description: '产品描述',
  facts: '产品事实',
  cautions: '使用限制（每行一条）',
  brandId: '关联品牌',
  referenceAssetIds: '产品参考图片',
  visibility: '可见范围',
  validUntil: '产品有效期',
};
const enumLabels: Record<string, string> = {
  profile: '长期背景',
  preference: '创作偏好',
  temporary: '临时要求',
  all: '图片与视频',
  image: '图片',
  video: '视频',
  active: '启用',
  paused: '停用',
  private: '仅自己',
  workspace: '空间共享',
};
function ReferenceName({ type, id }: { type: 'brands' | 'assets'; id: string }) {
  const result = useApi<BrandDto | AssetDto>(`/${type}/${id}`);
  return (
    <span>
      {result.data?.name ?? t(result.error ? '所选资料不可用，请重新选择' : '正在读取资料')}
    </span>
  );
}
function Value({ name, value }: { name: string; value: unknown }) {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && !value.length)
  )
    return <span>{t('未设置')}</span>;
  if ((name === 'brandId' || name === 'coverAssetId') && typeof value === 'string')
    return <ReferenceName type={name === 'brandId' ? 'brands' : 'assets'} id={value} />;
  if (name === 'referenceAssetIds' && Array.isArray(value))
    return (
      <ul>
        {value.map((id) => (
          <li key={id}>
            <ReferenceName type="assets" id={id} />
          </li>
        ))}
      </ul>
    );
  if (name === 'expiresAt' || name === 'validUntil')
    return (
      <span>
        {new Intl.DateTimeFormat(getLocale(), {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short',
        }).format(new Date(String(value)))}
      </span>
    );
  if (['kind', 'mediaType', 'status', 'visibility'].includes(name))
    return <span>{t(enumLabels[String(value)] ?? String(value))}</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((entry, index) => (
          <li key={index}>{String(entry)}</li>
        ))}
      </ul>
    );
  return <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(value)}</span>;
}

export function KnowledgeConflict<T extends object>({
  base,
  draft,
  current,
  busy,
  onMerge,
  onReload,
  fieldLabels,
}: {
  base: T;
  draft: T;
  current: T & { version?: number; updatedAt: string };
  busy: boolean;
  onMerge: (merged: T) => void;
  onReload: () => void;
  fieldLabels?: Readonly<Record<string, string>>;
}) {
  return (
    <Notice tone="warning">
      <p>{t('记录已被其他窗口修改，当前输入已保留。请核对最新记录后选择如何继续。')}</p>
      <details open>
        <summary>
          {t('服务器最新记录')} ·{' '}
          {current.version === undefined
            ? `${t('更新时间')} ${current.updatedAt}`
            : `${t('版本')} ${current.version}`}
        </summary>
        <dl>
          {(Object.keys(base) as (keyof T)[]).map((key) => {
            const conflict =
              !same(base[key], draft[key]) &&
              !same(base[key], current[key]) &&
              !same(draft[key], current[key]);
            return (
              <div key={String(key)} style={{ overflowWrap: 'anywhere' }}>
                <dt>
                  <strong>
                    {t(fieldLabels?.[String(key)] ?? labels[String(key)] ?? String(key))}
                  </strong>
                  {conflict && <> · {t('双方已修改')}</>}
                </dt>
                <dd>
                  <Value name={String(key)} value={current[key]} />
                </dd>
                {conflict && (
                  <dd>
                    {t('当前输入')}：<Value name={String(key)} value={draft[key]} />
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
      </details>
      <p>
        {t('合并会采用未改动字段的最新内容；双方修改的字段保留当前输入。合并后仍需核对并保存。')}
      </p>
      <div className="card-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => onMerge(mergeKnowledgeInput(base, draft, current))}
        >
          {t('合并最新记录并继续编辑')}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onReload}>
          {t('载入最新记录，放弃当前修改')}
        </Button>
      </div>
    </Notice>
  );
}
