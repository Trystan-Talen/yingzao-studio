import { t } from '../lib/i18n';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  FlipHorizontal2,
  FlipVertical2,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { SceneDocumentV1, SceneLayer } from '../../contracts/scene.js';
import type { EditorAsset } from './types.js';

interface PropertiesPanelProps {
  scene: SceneDocumentV1;
  layer: SceneLayer | undefined;
  assets: EditorAsset[];
  readOnly: boolean;
  allowOriginalDownload?: boolean;
  onPatch: (id: string, patch: Partial<SceneLayer>) => void;
  onCanvas: (patch: Partial<SceneDocumentV1['canvas']>) => void;
  onAlign: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(String(Number(value.toFixed(3))));
  }, [value]);
  return (
    <label className="ce-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.currentTarget.value = String(Number(value.toFixed(3)));
            setDraft(event.currentTarget.value);
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (
            Number.isFinite(value) &&
            (min === undefined || value >= min) &&
            (max === undefined || value <= max)
          ) {
            onChange(value);
            setError('');
          } else setError(t('请输入范围内的有效数值。'));
        }}
      />
      {error && (
        <span id={`${id}-error`} role="alert" className="ce-field-error">
          {error}
        </span>
      )}
    </label>
  );
}

function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <label className="ce-field" htmlFor={id}>
      <span>{label}</span>
      <div className="ce-color">
        <input
          id={id}
          type="color"
          value={/^#[\da-fA-F]{6}/.test(value) ? value.slice(0, 7) : '#FFFFFF'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <span>{value === 'transparent' ? t('透明') : value.toUpperCase()}</span>
      </div>
    </label>
  );
}

export function PropertiesPanel({
  scene,
  layer,
  assets,
  readOnly,
  allowOriginalDownload = true,
  onPatch,
  onCanvas,
  onAlign,
}: PropertiesPanelProps) {
  const [cropOpen, setCropOpen] = useState(false);
  const disabled = readOnly || (layer?.locked ?? false);
  const patch = (value: Partial<SceneLayer>) => {
    if (layer) onPatch(layer.id, value);
  };
  const asset =
    layer && (layer.type === 'image' || layer.type === 'video')
      ? assets.find((item) => item.id === layer.assetId)
      : undefined;
  return (
    <section className="ce-panel-content" aria-label={t('属性设置')}>
      <div className="ce-panel-heading">
        <span>
          <SlidersHorizontal size={16} /> {layer ? t('图层属性') : t('画布设置')}
        </span>
      </div>
      {!layer ? (
        <>
          <div className="ce-field-grid">
            <NumberField
              label={t('宽度 · px')}
              value={scene.canvas.width}
              min={1}
              max={32768}
              disabled={readOnly}
              onChange={(width) => onCanvas({ width })}
            />
            <NumberField
              label={t('高度 · px')}
              value={scene.canvas.height}
              min={1}
              max={32768}
              disabled={readOnly}
              onChange={(height) => onCanvas({ height })}
            />
          </div>
          <ColorField
            label={t('画布背景')}
            value={scene.canvas.background}
            disabled={readOnly}
            onChange={(background) => onCanvas({ background })}
          />
          <label className="ce-check">
            <input
              type="checkbox"
              checked={scene.canvas.background === 'transparent'}
              disabled={readOnly}
              onChange={(event) =>
                onCanvas({ background: event.target.checked ? 'transparent' : '#FFFFFF' })
              }
            />
            {t('透明背景')}
          </label>
          <p className="ce-panel-note">
            {t('选中图层可调整位置、样式和媒体属性。画布设置以像素为单位。')}
          </p>
        </>
      ) : (
        <>
          {layer.locked && <p className="ce-panel-note">{t('此图层已锁定，可在图层面板解锁。')}</p>}
          <label className="ce-field">
            <span>{t('名称')}</span>
            <input
              value={layer.name}
              disabled={disabled}
              maxLength={160}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <div className="ce-field-grid">
            <NumberField
              label="X"
              value={layer.x}
              disabled={disabled}
              onChange={(x) => patch({ x })}
            />
            <NumberField
              label="Y"
              value={layer.y}
              disabled={disabled}
              onChange={(y) => patch({ y })}
            />
            <NumberField
              label={t('宽度')}
              value={layer.width}
              min={0.1}
              max={32768}
              disabled={disabled}
              onChange={(width) => patch({ width })}
            />
            <NumberField
              label={t('高度')}
              value={layer.height}
              min={0.1}
              max={32768}
              disabled={disabled || layer.type === 'text'}
              onChange={(height) => patch({ height })}
            />
            <NumberField
              label={t('水平缩放')}
              value={layer.scaleX}
              min={0.001}
              max={1000}
              step={0.1}
              disabled={disabled}
              onChange={(scaleX) => patch({ scaleX })}
            />
            <NumberField
              label={t('垂直缩放')}
              value={layer.scaleY}
              min={0.001}
              max={1000}
              step={0.1}
              disabled={disabled}
              onChange={(scaleY) => patch({ scaleY })}
            />
            <NumberField
              label={t('旋转 · °')}
              value={layer.rotation}
              min={-360}
              max={360}
              disabled={disabled}
              onChange={(rotation) => patch({ rotation })}
            />
            <NumberField
              label={t('不透明度 · %')}
              value={layer.opacity * 100}
              min={0}
              max={100}
              disabled={disabled}
              onChange={(opacity) => patch({ opacity: opacity / 100 })}
            />
          </div>
          <div className="ce-mini-toolbar">
            <button
              type="button"
              disabled={disabled}
              onClick={() => patch({ flipX: !layer.flipX })}
              title={t('水平翻转')}
              aria-label={t('水平翻转')}
            >
              <FlipHorizontal2 size={16} />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => patch({ flipY: !layer.flipY })}
              title={t('垂直翻转')}
              aria-label={t('垂直翻转')}
            >
              <FlipVertical2 size={16} />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAlign('left')}
              title={t('左对齐画布')}
              aria-label={t('左对齐画布')}
            >
              <AlignLeft size={16} />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAlign('center')}
              title={t('水平居中')}
              aria-label={t('水平居中')}
            >
              <AlignCenter size={16} />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAlign('right')}
              title={t('右对齐画布')}
              aria-label={t('右对齐画布')}
            >
              <AlignRight size={16} />
            </button>
            <button type="button" disabled={disabled} onClick={() => onAlign('middle')}>
              {t('垂直居中')}
            </button>
          </div>
          {layer.type === 'text' && (
            <>
              <div className="ce-section-label">{t('文字')}</div>
              <label className="ce-field">
                <span>{t('内容')}</span>
                <textarea
                  value={layer.text}
                  disabled={disabled}
                  maxLength={20000}
                  rows={4}
                  onChange={(event) => patch({ text: event.target.value })}
                />
              </label>
              <label className="ce-field">
                <span>{t('字体')}</span>
                <select
                  value={layer.fontFamily}
                  disabled={disabled}
                  onChange={(event) => patch({ fontFamily: event.target.value })}
                >
                  <option value="sans-serif">{t('系统黑体')}</option>
                  <option value="serif">{t('系统宋体')}</option>
                  <option value="monospace">{t('等宽字体')}</option>
                  <option value="PingFang SC">{t('苹方')}</option>
                  <option value="Microsoft YaHei">{t('微软雅黑')}</option>
                </select>
              </label>
              <div className="ce-field-grid">
                <NumberField
                  label={t('字号')}
                  value={layer.fontSize}
                  min={1}
                  max={2000}
                  disabled={disabled}
                  onChange={(fontSize) => patch({ fontSize })}
                />
                <NumberField
                  label={t('行距')}
                  value={layer.lineHeight}
                  min={0.5}
                  max={5}
                  step={0.1}
                  disabled={disabled}
                  onChange={(lineHeight) => patch({ lineHeight })}
                />
              </div>
              <div className="ce-mini-toolbar">
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={layer.fontWeight === 'bold'}
                  onClick={() =>
                    patch({ fontWeight: layer.fontWeight === 'bold' ? 'normal' : 'bold' })
                  }
                >
                  <b>{t('粗体')}</b>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={layer.fontStyle === 'italic'}
                  onClick={() =>
                    patch({ fontStyle: layer.fontStyle === 'italic' ? 'normal' : 'italic' })
                  }
                >
                  <i>{t('斜体')}</i>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={layer.underline}
                  onClick={() => patch({ underline: !layer.underline })}
                >
                  <u>{t('下划线')}</u>
                </button>
              </div>
              <label className="ce-field">
                <span>{t('段落对齐')}</span>
                <select
                  value={layer.textAlign}
                  disabled={disabled}
                  onChange={(event) =>
                    patch({ textAlign: event.target.value as 'left' | 'center' | 'right' })
                  }
                >
                  <option value="left">{t('左对齐')}</option>
                  <option value="center">{t('居中')}</option>
                  <option value="right">{t('右对齐')}</option>
                </select>
              </label>
              <ColorField
                label={t('文字颜色')}
                value={layer.fill}
                disabled={disabled}
                onChange={(fill) => patch({ fill })}
              />
            </>
          )}
          {layer.type === 'shape' && (
            <>
              <div className="ce-section-label">{t('图形')}</div>
              <ColorField
                label={t('填充')}
                value={layer.fill}
                disabled={disabled}
                onChange={(fill) => patch({ fill })}
              />
              <ColorField
                label={t('描边')}
                value={layer.stroke}
                disabled={disabled}
                onChange={(stroke) => patch({ stroke })}
              />
              <div className="ce-field-grid">
                <NumberField
                  label={t('描边宽度')}
                  value={layer.strokeWidth}
                  min={0}
                  max={1000}
                  disabled={disabled}
                  onChange={(strokeWidth) => patch({ strokeWidth })}
                />
                {layer.shape === 'rect' && (
                  <NumberField
                    label={t('圆角')}
                    value={layer.cornerRadius}
                    min={0}
                    max={16384}
                    disabled={disabled}
                    onChange={(cornerRadius) => patch({ cornerRadius })}
                  />
                )}
              </div>
            </>
          )}
          {layer.type === 'image' && (
            <>
              <div className="ce-section-label">{t('图片裁剪')}</div>
              <p className="ce-panel-note">{t('按原图像素设置裁剪区域，不会修改原始素材。')}</p>
              <button
                type="button"
                className="ce-secondary-button"
                disabled={disabled || !asset?.width || !asset.height}
                aria-expanded={cropOpen}
                onClick={() => setCropOpen(!cropOpen)}
              >
                {cropOpen ? t('收起裁剪') : t('设置裁剪')}
              </button>
              {cropOpen && asset?.width && asset.height ? (
                <div className="ce-field-grid">
                  {(['x', 'y', 'width', 'height'] as const).map((field) => {
                    const crop = layer.crop ?? {
                      x: 0,
                      y: 0,
                      width: asset.width ?? 1,
                      height: asset.height ?? 1,
                    };
                    return (
                      <NumberField
                        key={field}
                        label={
                          {
                            x: t('左边距'),
                            y: t('上边距'),
                            width: t('区域宽度'),
                            height: t('区域高度'),
                          }[field]
                        }
                        value={crop[field]}
                        min={field === 'width' || field === 'height' ? 1 : 0}
                        max={
                          field === 'x' || field === 'width'
                            ? (asset.width ?? 32768)
                            : (asset.height ?? 32768)
                        }
                        disabled={disabled}
                        onChange={(value) => {
                          const next = { ...crop, [field]: value };
                          next.x = Math.min(next.x, (asset.width ?? 1) - 1);
                          next.y = Math.min(next.y, (asset.height ?? 1) - 1);
                          next.width = Math.min(next.width, (asset.width ?? 1) - next.x);
                          next.height = Math.min(next.height, (asset.height ?? 1) - next.y);
                          patch({ crop: next });
                        }}
                      />
                    );
                  })}
                </div>
              ) : null}
              {layer.crop && (
                <button
                  type="button"
                  className="ce-secondary-button"
                  disabled={disabled}
                  onClick={() => patch({ crop: null })}
                >
                  {t('恢复完整图片')}
                </button>
              )}
            </>
          )}
          {layer.type === 'video' && (
            <>
              <div className="ce-section-label">
                {t('视频 ·')}
                {(layer.durationMs / 1000).toFixed(1)}s
              </div>
              {asset && asset.playable !== false && (
                <video
                  className="ce-video-preview"
                  key={`${asset.id}:${layer.trimStartMs}:${layer.trimEndMs}`}
                  controls
                  playsInline
                  preload="metadata"
                  src={asset.originalUrl}
                  muted={layer.muted}
                  loop={layer.loop}
                  onLoadedMetadata={(event) => {
                    event.currentTarget.currentTime = layer.trimStartMs / 1000;
                  }}
                  onTimeUpdate={(event) => {
                    if (event.currentTarget.currentTime * 1000 >= layer.trimEndMs) {
                      if (layer.loop) event.currentTarget.currentTime = layer.trimStartMs / 1000;
                      else event.currentTarget.pause();
                    }
                  }}
                />
              )}
              {asset?.playable === false && (
                <p className="ce-panel-note">{t('分享仅提供视频缩略图，未授权原件播放。')}</p>
              )}
              <div className="ce-field-grid">
                <NumberField
                  label={t('开始 · 秒')}
                  value={layer.trimStartMs / 1000}
                  min={0}
                  max={(layer.trimEndMs - 1) / 1000}
                  step={0.1}
                  disabled={disabled}
                  onChange={(value) => patch({ trimStartMs: Math.round(value * 1000) })}
                />
                <NumberField
                  label={t('结束 · 秒')}
                  value={layer.trimEndMs / 1000}
                  min={(layer.trimStartMs + 1) / 1000}
                  max={layer.durationMs / 1000}
                  step={0.1}
                  disabled={disabled}
                  onChange={(value) => patch({ trimEndMs: Math.round(value * 1000) })}
                />
              </div>
              <label className="ce-check">
                <input
                  type="checkbox"
                  checked={layer.muted}
                  disabled={disabled}
                  onChange={(event) => patch({ muted: event.target.checked })}
                />
                {t('静音预览')}
              </label>
              <label className="ce-check">
                <input
                  type="checkbox"
                  checked={layer.loop}
                  disabled={disabled}
                  onChange={(event) => patch({ loop: event.target.checked })}
                />
                {t('循环预览')}
              </label>
              {asset && allowOriginalDownload && asset.originalAvailable !== false && (
                <a className="ce-secondary-button" href={asset.originalUrl} download={asset.name}>
                  {t('下载视频原件')}
                </a>
              )}
              <p className="ce-panel-note">
                {t(
                  '画布显示视频静帧，PNG/JPG导出也是静态图片。以上区间用于预览；要得到裁剪后的MP4，请使用视频裁剪工具。',
                )}
              </p>
            </>
          )}
          {layer.type === 'group' && (
            <p className="ce-panel-note">
              {t('组内有')}
              {layer.children.length}
              {t('个图层。取消分组后可以编辑各个内容。')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
