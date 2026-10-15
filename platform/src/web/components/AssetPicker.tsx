import { t } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { Check, FileText, ImagePlus, Music, Play, Plus, Upload, X } from 'lucide-react';
import type { AssetDto } from '../../contracts/core';
import { bytes, errorMessage, qs, uploadAsset, useApi, useRefresh, type Page } from '../lib/api';
import { Button, Empty, ErrorState, IconButton, Loading, Modal, Pagination, useToast } from './ui';
import { useStudio } from '../context';
export function AssetVisual({ asset, className = '' }: { asset: AssetDto; className?: string }) {
  return asset.kind === 'image' ? (
    <img
      className={className}
      src={asset.thumbnailUrl ?? asset.previewUrl ?? asset.originalUrl}
      alt={asset.name}
      loading="lazy"
    />
  ) : asset.kind === 'video' ? (
    <div className={`media-placeholder ${className}`}>
      {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt={asset.name} /> : <Play />}
      <span>{t('视频')}</span>
    </div>
  ) : (
    <div className={`media-placeholder ${className}`}>
      {asset.kind === 'audio' ? <Music /> : <FileText />}
      <span>{asset.kind === 'audio' ? t('音频') : t('文档')}</span>
    </div>
  );
}
interface UploadRow {
  id: string;
  file: File;
  status: 'queued' | 'uploading' | 'succeeded' | 'failed';
  progress: number;
  error?: string;
  asset?: AssetDto;
}
export function AssetPicker({
  value,
  onChange,
  label = '参考素材',
  kind = 'image',
  max = 20,
  projectId,
  compact = false,
  roleLabels,
}: {
  value: AssetDto[];
  onChange: (value: AssetDto[]) => void;
  label?: string;
  kind?: string;
  max?: number;
  projectId?: string;
  compact?: boolean;
  roleLabels?: string[];
}) {
  const { canEdit, workspace } = useStudio();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const rowsRef = useRef<UploadRow[]>([]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  function updateRows(rows: UploadRow[]) {
    rowsRef.current = rows;
    setUploads([...rows]);
  }
  useEffect(() => {
    updateRows([]);
    return () => {
      controller.current?.abort();
    };
  }, [workspace?.id]);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const refresh = useRefresh();
  const query = useApi<Page<AssetDto>>(
    `/assets${qs({ kind: ['all', 'visual'].includes(kind) ? undefined : kind, q, pageSize: 30, page })}`,
    open,
  );
  async function processRows() {
    if (inFlight.current || !canEdit) return;
    inFlight.current = true;
    setBusy(true);
    const abortController = new AbortController();
    controller.current = abortController;
    const workspaceId = workspace?.id ?? null;
    try {
      for (const row of rowsRef.current.filter((item) => item.status === 'queued')) {
        if (abortController.signal.aborted) break;
        if (valueRef.current.length >= max) {
          row.status = 'failed';
          row.error = t('已达到素材数量上限，请先移除部分素材。');
          updateRows(rowsRef.current);
          continue;
        }
        row.status = 'uploading';
        row.error = undefined;
        updateRows(rowsRef.current);
        try {
          const asset = await uploadAsset<AssetDto>(row.file, projectId, {
            uploadId: row.id,
            workspaceId,
            signal: abortController.signal,
            onProgress: (progress) => {
              row.progress = progress;
              updateRows(rowsRef.current);
            },
          });
          if (abortController.signal.aborted) break;
          row.status = 'succeeded';
          row.asset = asset;
          row.progress = 100;
          updateRows(rowsRef.current);
          if (!valueRef.current.some((item) => item.id === asset.id)) {
            if (valueRef.current.length < max) {
              const next = [...valueRef.current, asset];
              valueRef.current = next;
              changeRef.current(next);
            } else {
              toast(t('已达到素材数量上限，请先移除部分素材。'), 'error');
            }
          }
        } catch (error) {
          if (abortController.signal.aborted) break;
          row.status = 'failed';
          row.error = errorMessage(error);
          updateRows(rowsRef.current);
        }
      }
      if (!abortController.signal.aborted) await refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  function upload(files: FileList | File[] | null) {
    if (!files || !canEdit || inFlight.current) return;
    const accepted = Array.from(files).filter((file) => {
      const category = file.type.split('/')[0] ?? '';
      return (
        kind === 'all' ||
        (kind === 'visual' && ['image', 'video'].includes(category)) ||
        category === kind ||
        (kind === 'document' && !['image', 'video', 'audio'].includes(category))
      );
    });
    if (accepted.length !== files.length) toast(t('部分文件不符合当前素材类型，已跳过。'), 'error');
    const remaining = Math.max(0, max - valueRef.current.length);
    if (accepted.length > remaining) toast(t('已达到素材数量上限，请先移除部分素材。'), 'error');
    const additions: UploadRow[] = [];
    for (const file of accepted.slice(0, remaining)) {
      const existing = rowsRef.current.find(
        (item) =>
          item.file.name === file.name &&
          item.file.size === file.size &&
          item.file.lastModified === file.lastModified,
      );
      if (existing) {
        if (existing.status === 'failed') {
          existing.status = 'queued';
          existing.progress = 0;
        } else if (
          existing.asset &&
          valueRef.current.length < max &&
          !valueRef.current.some((item) => item.id === existing.asset?.id)
        ) {
          const next = [...valueRef.current, existing.asset];
          valueRef.current = next;
          changeRef.current(next);
        }
        continue;
      }
      additions.push({ id: crypto.randomUUID(), file, status: 'queued', progress: 0 });
    }
    updateRows([...rowsRef.current, ...additions]);
    void processRows();
  }
  const transferEvents = {
    onDragOver: (event: React.DragEvent) => {
      if (canEdit && event.dataTransfer.types.includes('Files')) {
        event.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      upload(event.dataTransfer.files);
    },
    onPaste: (event: React.ClipboardEvent) => {
      if (event.clipboardData.files.length) {
        event.preventDefault();
        upload(event.clipboardData.files);
      }
    },
  };
  const uploadFeedback = (
    <>
      <div
        className={`upload-drop-zone ${dragging ? 'dragging' : ''}`}
        tabIndex={canEdit ? 0 : -1}
        {...transferEvents}
      >
        <Upload size={16} />
        <span>{t('拖入文件，或聚焦这里粘贴图片')}</span>
      </div>
      {!!uploads.length && (
        <div className="upload-queue" aria-live="polite">
          {uploads.map((row) => (
            <div key={row.id} className="upload-row">
              <div>
                <strong>{row.file.name}</strong>
                <small>
                  {row.status === 'succeeded'
                    ? t('已保存')
                    : row.status === 'failed'
                      ? row.error
                      : row.progress === 100
                        ? t('正在校验并保存…')
                        : `${row.progress}%`}
                </small>
                {['uploading', 'queued'].includes(row.status) && (
                  <progress
                    max={100}
                    value={row.progress}
                    aria-label={`${t('上传进度')} ${row.file.name}`}
                  />
                )}
              </div>
              {row.status === 'failed' && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    row.status = 'queued';
                    row.progress = 0;
                    updateRows(rowsRef.current);
                    void processRows();
                  }}
                >
                  {t('重试')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
  return (
    <div className={`asset-picker ${compact ? 'compact' : ''}`}>
      <div className="field-label asset-picker-heading">
        <span>{t(label)}</span>
        <span className="muted">
          {value.length} / {max}
        </span>
      </div>
      <div className="asset-chips">
        {value.map((asset, index) => (
          <div className="asset-chip" key={`${asset.id}-${index}`}>
            <AssetVisual asset={asset} />
            <span title={asset.name}>
              {roleLabels?.[index] && <small>{t(roleLabels[index])} · </small>}
              {asset.name}
            </span>
            <IconButton
              label={`移除${asset.name}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <X size={13} />
            </IconButton>
          </div>
        ))}
        {value.length < max && (
          <button
            type="button"
            className="asset-add"
            onClick={() => setOpen(true)}
            disabled={!canEdit}
          >
            <ImagePlus size={21} />
            <span>{value.length ? t('添加') : t('添加素材')}</span>
          </button>
        )}
      </div>
      {canEdit && uploadFeedback}
      <input
        ref={input}
        type="file"
        hidden
        multiple={max > 1}
        accept={
          kind === 'image'
            ? 'image/png,image/jpeg,image/webp'
            : kind === 'video'
              ? 'video/mp4,video/quicktime'
              : kind === 'visual'
                ? 'image/png,image/jpeg,image/webp,video/mp4,video/quicktime'
                : undefined
        }
        onChange={(event) => void upload(event.target.files)}
      />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        description={t('从当前工作空间选择，或上传自己的素材。')}
        wide
      >
        <div className="toolbar">
          <input
            placeholder={t('搜索素材')}
            aria-label={t('搜索素材')}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          <Button
            onClick={() => input.current?.click()}
            busy={busy}
            disabled={!canEdit || value.length >= max}
          >
            <Upload size={16} />
            {t('上传')}
          </Button>
        </div>
        {canEdit && uploadFeedback}
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={query.refetch} />
        ) : query.data?.items.length ? (
          <div className="asset-select-grid">
            {query.data.items
              .filter((asset) => kind !== 'visual' || ['image', 'video'].includes(asset.kind))
              .map((asset) => {
                const selected = value.some((a) => a.id === asset.id);
                return (
                  <button
                    type="button"
                    key={asset.id}
                    className={`asset-select ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      if (selected) onChange(value.filter((a) => a.id !== asset.id));
                      else if (value.length < max) onChange([...value, asset]);
                      else toast(`最多选择 ${max} 个素材`, 'error');
                    }}
                  >
                    <AssetVisual asset={asset} />
                    <span>{asset.name}</span>
                    <small>{bytes(asset.byteSize)}</small>
                    {selected && (
                      <span className="selected-tick">
                        <Check size={14} />
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        ) : (
          <Empty
            title={t('还没有可用素材')}
            description={t('上传的原件会保存在当前空间，可在各个项目间复用。')}
            action={
              <Button variant="secondary" onClick={() => input.current?.click()} busy={busy}>
                <Plus size={16} />
                {t('上传素材')}
              </Button>
            }
          />
        )}
        {query.data && (
          <Pagination
            page={page}
            total={query.data.total}
            pageSize={query.data.pageSize}
            onPage={setPage}
          />
        )}
        <div className="modal-actions">
          <span className="muted">
            {t('已选择')}
            {value.length}
            {t('项')}
          </span>
          <Button onClick={() => setOpen(false)}>{t('完成选择')}</Button>
        </div>
      </Modal>
    </div>
  );
}
