import { t } from '../lib/i18n';
import { useState } from 'react';
import type { AssetDto } from '../../contracts/core';
import { useApi } from '../lib/api';
import { Button, ErrorState, Loading, Notice } from './ui';

export function ResultComparison({ sourceIds, result }: { sourceIds: string[]; result: AssetDto }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(sourceIds[0] ?? '');
  const source = useApi<AssetDto>(`/assets/${selected}`, open && !!selected);
  if (result.kind !== 'image' || !sourceIds.length) return null;
  return (
    <section className="result-comparison" aria-label={t('原图与结果对比')}>
      <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t('收起原图对比') : t('查看原图对比')}
      </Button>
      {open && (
        <>
          {sourceIds.length > 1 && (
            <label className="field">
              <span className="field-label">{t('选择输入素材')}</span>
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                {sourceIds.map((id, index) => (
                  <option key={id} value={id}>
                    {t('输入')} {index + 1} · {id.slice(-8)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {source.isLoading ? (
            <Loading />
          ) : source.error ? (
            <ErrorState error={source.error} retry={source.refetch} />
          ) : source.data?.kind !== 'image' ? (
            <Notice>{t('此输入不是图片，请在素材库查看原文件。')}</Notice>
          ) : (
            <div className="comparison-images">
              {[
                { label: '输入原图', asset: source.data },
                { label: '处理结果', asset: result },
              ].map(({ label, asset }) => (
                <figure key={label}>
                  <figcaption>
                    {t(label)} · {asset.width} × {asset.height}
                  </figcaption>
                  <img src={asset.originalUrl} alt={`${t(label)}: ${asset.name}`} />
                </figure>
              ))}
            </div>
          )}
          <p className="field-hint">{t('按各自比例完整显示，不裁切；可下载原件检查细节。')}</p>
        </>
      )}
    </section>
  );
}
