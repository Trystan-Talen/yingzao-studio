import { useState } from 'react';
import type { BrandDto } from '../../contracts/core';
import type { ProductDto } from '../../contracts/knowledge';
import { useApi, qs, type Page } from '../lib/api';
import { t } from '../lib/i18n';
import { ErrorState, Field, Pagination } from './ui';

export function localDateTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function isoDateTime(value: string) {
  return value ? new Date(value).toISOString() : null;
}

/** Search is server-paged, and a selected record remains visible outside the current page. */
export function KnowledgeSelect({
  type,
  label,
  value,
  onChange,
  disabled = false,
  emptyLabel,
}: {
  type: 'brands' | 'products';
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const list = useApi<Page<BrandDto | ProductDto>>(
    `/${type}${qs({ q: query, page, pageSize: 24 })}`,
  );
  const selected = useApi<BrandDto | ProductDto>(`/${type}/${value}`, !!value);
  const entries = list.data?.items ?? [];
  const selectedOutside = value && !entries.some((entry) => entry.id === value);
  return (
    <div className="knowledge-selector">
      <Field label={label}>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        >
          <option value="">
            {emptyLabel ?? t(type === 'brands' ? '不使用品牌' : '不使用产品')}
          </option>
          {selectedOutside && (
            <option value={value}>
              {selected.data?.name ??
                t(selected.error ? '所选资料不可用，请重新选择' : '正在读取资料')}
            </option>
          )}
          {entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </Field>
      <details>
        <summary>{t(type === 'brands' ? '搜索更多品牌' : '搜索更多产品')}</summary>
        <input
          aria-label={t(type === 'brands' ? '查找品牌' : '查找产品')}
          value={query}
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
        {list.data && (
          <Pagination page={page} total={list.data.total} pageSize={24} onPage={setPage} />
        )}
      </details>
      {list.error && <ErrorState error={list.error} retry={list.refetch} />}
      {selected.error && <ErrorState error={selected.error} retry={selected.refetch} />}
    </div>
  );
}
