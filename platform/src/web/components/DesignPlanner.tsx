import { t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { AssetDto } from '../../contracts/core';
import type { JobInput } from '../../contracts/jobs';
import { IMAGE_RATIOS } from '../../contracts/catalog';
import { api } from '../lib/api';
import { AssetPicker } from './AssetPicker';
import { Button, Field, Notice } from './ui';
export type MaterialDesign = NonNullable<JobInput['options']['designs']>[number];
const modules = [
  ['hero', '商品主视觉'],
  ['benefits', '核心卖点'],
  ['details', '材质与细节'],
  ['lifestyle', '使用场景'],
  ['specifications', '规格参数'],
  ['comparison', '产品对比'],
  ['campaign', '活动海报'],
  ['custom', '自定义模块'],
] as const;
export function createDesign(kind = 'hero'): MaterialDesign {
  return {
    id: crypto.randomUUID(),
    kind,
    name: modules.find((m) => m[0] === kind)?.[1] ?? '自定义模块',
    ratio: '1:1',
    prompt: '',
    assetIds: [],
  };
}
export function DesignPlanner({
  value,
  onChange,
  ratios,
  projectId,
  count,
}: {
  value: MaterialDesign[];
  onChange: (value: MaterialDesign[]) => void;
  ratios?: readonly string[];
  projectId?: string;
  count: number;
}) {
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [error, setError] = useState('');
  const ids = [...new Set(value.flatMap((v) => v.assetIds))];
  useEffect(() => {
    let active = true;
    void Promise.all(ids.map((id) => api<AssetDto>(`/assets/${id}`)))
      .then((items) => {
        if (active) {
          setAssets(items);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : '物料参考素材读取失败');
      });
    return () => {
      active = false;
    };
  }, [ids.join(',')]);
  function patch(id: string, update: Partial<MaterialDesign>) {
    onChange(value.map((item) => (item.id === id ? { ...item, ...update } : item)));
  }
  function move(index: number, offset: number) {
    const next = [...value];
    const item = next.splice(index, 1)[0];
    if (item) next.splice(index + offset, 0, item);
    onChange(next);
  }
  return (
    <section className="design-planner">
      <div className="section-heading">
        <h3>{t('物料规划')}</h3>
        <span className="muted">
          {value.length}
          {t('个模块 ·')}
          {value.length * count}
          {t('张')}
        </span>
      </div>
      <p className="muted">
        {t('按顺序生成独立物料。每个模块继承总体需求，并使用自己的构图、比例与参考图片。')}
      </p>
      {error && <Notice tone="warning">{error}</Notice>}
      {value.map((item, index) => (
        <article className="design-module" key={item.id}>
          <div className="design-module-heading">
            <span className="badge">{String(index + 1).padStart(2, '0')}</span>
            <strong>{item.name || '未命名模块'}</strong>
            <div className="inline-actions">
              <Button
                variant="ghost"
                aria-label={t('上移模块')}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                variant="ghost"
                aria-label={t('下移模块')}
                disabled={index === value.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={14} />
              </Button>
              <Button
                variant="ghost"
                aria-label={t('删除模块')}
                disabled={value.length === 1}
                onClick={() => onChange(value.filter((v) => v.id !== item.id))}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          <Field label={t('模块名称')}>
            <input
              value={item.name}
              maxLength={80}
              onChange={(e) => patch(item.id, { name: e.target.value })}
            />
          </Field>
          <div className="form-grid">
            <Field label={t('模块类型')}>
              <select value={item.kind} onChange={(e) => patch(item.id, { kind: e.target.value })}>
                {modules.map((m) => (
                  <option value={m[0]} key={m[0]}>
                    {t(m[1])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('模块比例')}>
              <select
                value={item.ratio}
                onChange={(e) => patch(item.id, { ratio: e.target.value })}
              >
                {(ratios?.length ? ratios : IMAGE_RATIOS).map((r) => (
                  <option key={r} value={r}>
                    {r === 'auto' ? t('智能比例') : r}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('模块构图与文案')}>
            <textarea
              rows={3}
              value={item.prompt}
              maxLength={2000}
              placeholder={t('描述这个模块的构图、产品细节和需要呈现的文字…')}
              onChange={(e) => patch(item.id, { prompt: e.target.value })}
            />
          </Field>
          <AssetPicker
            label={t('模块专属参考')}
            kind="image"
            value={assets.filter((a) => item.assetIds.includes(a.id))}
            max={16}
            projectId={projectId}
            onChange={(items) => {
              setAssets((previous) => [
                ...new Map([...previous, ...items].map((a) => [a.id, a])).values(),
              ]);
              patch(item.id, { assetIds: items.map((a) => a.id) });
            }}
          />
        </article>
      ))}
      <Button
        variant="secondary"
        disabled={value.length >= 20}
        onClick={() => onChange([...value, createDesign('custom')])}
      >
        <Plus size={15} />
        {t('添加物料模块')}
      </Button>
    </section>
  );
}
