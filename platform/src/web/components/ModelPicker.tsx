import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, Search } from 'lucide-react';
import { t } from '../lib/i18n';

export function ModelPicker({
  label,
  hint,
  value,
  onChange,
  models,
  loading,
  connected,
  required = false,
  vision = false,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (model: string) => void;
  models: string[];
  loading: boolean;
  connected: boolean;
  required?: boolean;
  vision?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const filtered = models.filter((model) =>
    model.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const activeModel = filtered[active];

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open)
      list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function show() {
    // The current model can belong to a previous gateway. Only an explicit search filters results.
    setQuery('');
    setActive(-1);
    setOpen(true);
  }
  function select(model: string) {
    onChange(model);
    setOpen(false);
    input.current?.focus();
  }

  return (
    <div
      className="field model-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          input.current?.focus();
        }
      }}
    >
      <label className="field-label" htmlFor={`${id}-value`}>
        {label}
      </label>
      <div className="model-picker-control" aria-busy={loading}>
        <input
          ref={input}
          id={`${id}-value`}
          required={required}
          maxLength={120}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              show();
            }
          }}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          aria-describedby={`${id}-hint`}
        />
        <button
          type="button"
          className="model-picker-toggle"
          aria-label={t(vision ? '选择视觉模型' : '选择模型')}
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-haspopup="listbox"
          onClick={() => (open ? setOpen(false) : show())}
        >
          {loading ? (
            <LoaderCircle size={17} className="model-discovery-spinner" />
          ) : (
            <ChevronDown size={17} />
          )}
        </button>
      </div>
      <span className="field-hint" id={`${id}-hint`}>
        {hint}
      </span>
      {connected && !loading && models.length > 0 && (
        <span className="model-picker-count">
          {t('已获取 {count} 个模型，点击箭头选择。').replace('{count}', String(models.length))}
        </span>
      )}
      {connected && !loading && value.trim() && !models.includes(value.trim()) && (
        <span className="field-hint">{t('当前模型不在此目录中，可重新选择或手动保留。')}</span>
      )}
      {open && (
        <div className="model-picker-panel">
          <div className="model-picker-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={search}
              role="combobox"
              aria-label={t('搜索模型')}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={`${id}-list`}
              aria-activedescendant={activeModel ? `${id}-option-${active}` : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive((current) =>
                    !filtered.length
                      ? -1
                      : event.key === 'ArrowDown'
                        ? (current + 1) % filtered.length
                        : (current <= 0 ? filtered.length : current) - 1,
                  );
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  if (!loading && activeModel) select(activeModel);
                }
              }}
              placeholder={t('搜索模型名称…')}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={t('可选模型')}
            aria-busy={loading}
            className="model-picker-options"
          >
            {!loading &&
              filtered.map((model, index) => (
                <button
                  key={model}
                  id={`${id}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={value === model}
                  data-active={active === index}
                  tabIndex={-1}
                  onClick={() => select(model)}
                >
                  <span dir="ltr">{model}</span>
                  {value === model && <Check size={15} />}
                </button>
              ))}
          </div>
          {(loading || !filtered.length) && (
            <p className="model-picker-empty">
              {t(
                loading
                  ? '正在获取模型列表…'
                  : models.length
                    ? '没有匹配的模型，可修改搜索词或手动填写。'
                    : connected
                      ? '服务商返回了空目录，可手动填写模型标识。'
                      : '目录尚未就绪，可先手动填写模型标识。',
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
