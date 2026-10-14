import { t } from '../lib/i18n';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Group,
  Image,
  Layers,
  Lock,
  Square,
  Trash2,
  Type,
  Unlock,
  Video,
} from 'lucide-react';
import type { SceneLayer } from '../../contracts/scene.js';

interface LayerPanelProps {
  layers: SceneLayer[];
  selectedIds: string[];
  readOnly: boolean;
  onSelect: (id: string, multiple: boolean) => void;
  onPatch: (id: string, patch: Partial<SceneLayer>) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function LayerPanel({
  layers,
  selectedIds,
  readOnly,
  onSelect,
  onPatch,
  onMove,
  onDuplicate,
  onDelete,
}: LayerPanelProps) {
  return (
    <section className="ce-panel-content" aria-label={t('图层列表')}>
      <div className="ce-panel-heading">
        <span>
          <Layers size={16} />
          {t('图层')}
        </span>
        <span className="ce-muted">{layers.length}</span>
      </div>
      {layers.length === 0 && (
        <div className="ce-panel-empty">
          <Layers size={28} />
          <p>{t('从一段文字或一张图片开始。')}</p>
          <span>{t('添加的内容会出现在这里')}</span>
        </div>
      )}
      <div className="ce-layer-list">
        {[...layers].reverse().map((layer) => {
          const Icon =
            layer.type === 'text'
              ? Type
              : layer.type === 'image'
                ? Image
                : layer.type === 'video'
                  ? Video
                  : layer.type === 'group'
                    ? Group
                    : Square;
          const index = layers.indexOf(layer);
          return (
            <div
              key={layer.id}
              className={`ce-layer ${selectedIds.includes(layer.id) ? 'is-selected' : ''} ${!layer.visible ? 'is-hidden' : ''}`}
            >
              <button
                type="button"
                className="ce-layer-name"
                onClick={(event) =>
                  onSelect(layer.id, event.shiftKey || event.metaKey || event.ctrlKey)
                }
                aria-pressed={selectedIds.includes(layer.id)}
                title={layer.name}
              >
                <Icon size={16} />
                <span>{layer.name || t('未命名图层')}</span>
                {layer.type === 'group' && <small>{layer.children.length}</small>}
              </button>
              {!readOnly && (
                <div className="ce-layer-controls">
                  <button
                    type="button"
                    onClick={() => onPatch(layer.id, { visible: !layer.visible })}
                    aria-label={`${layer.visible ? t('隐藏') : t('显示')} ${layer.name}`}
                    title={layer.visible ? t('隐藏图层') : t('显示图层')}
                  >
                    {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onPatch(layer.id, { locked: !layer.locked })}
                    aria-label={`${layer.locked ? t('解锁') : t('锁定')} ${layer.name}`}
                    title={layer.locked ? t('解锁图层') : t('锁定图层')}
                  >
                    {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
                  </button>
                  <button
                    type="button"
                    disabled={layer.locked || index === layers.length - 1}
                    onClick={() => onMove(layer.id, 1)}
                    aria-label={`${t('上移')} ${layer.name}`}
                    title={t('上移一层')}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={layer.locked || index === 0}
                    onClick={() => onMove(layer.id, -1)}
                    aria-label={`${t('下移')} ${layer.name}`}
                    title={t('下移一层')}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={layer.locked}
                    onClick={() => onDuplicate(layer.id)}
                    aria-label={`${t('复制')} ${layer.name}`}
                    title={t('复制图层')}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={layer.locked}
                    onClick={() => onDelete(layer.id)}
                    aria-label={`${t('删除')} ${layer.name}`}
                    title={t('删除图层')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="ce-panel-note">{t('按住 Shift 点击可多选。列表顶端位于画面最前方。')}</p>
    </section>
  );
}
