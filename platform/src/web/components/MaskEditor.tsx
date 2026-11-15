import { t } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import type { AssetDto } from '../../contracts/core';
import { uploadAsset } from '../lib/api';
import {
  beginBackgroundMaskGesture,
  createBackgroundMaskSession,
  endBackgroundMaskGesture,
  moveBackgroundMaskGesture,
  resetBackgroundMaskSession,
} from '../lib/background-mask-stroke';
import { Button, Field, Notice, Segments, useAction, useToast } from './ui';
export function MaskEditor({
  asset,
  onMask,
  initialMask = null,
  initialMaskEncoding = 'alpha',
  purpose = 'edit',
  disabled = false,
}: {
  asset: AssetDto;
  onMask: (mask: AssetDto | null) => void;
  initialMask?: AssetDto | null;
  initialMaskEncoding?: 'alpha' | 'grayscale';
  purpose?: 'erase' | 'edit' | 'background';
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const active = useRef(false);
  const softSession = useRef(createBackgroundMaskSession());
  const softImage = useRef<ImageData | null>(null);
  const previous = useRef<{ x: number; y: number } | null>(null);
  const didDraw = useRef(false);
  const saving = useRef(false);
  const sourceVersion = useRef(0);
  const [mode, setMode] = useState<'brush' | 'erase'>('brush');
  const [size, setSize] = useState(30);
  const [softness, setSoftness] = useState(0);
  const [preventAccumulation, setPreventAccumulation] = useState(true);
  const [dirty, setDirty] = useState(false);
  const action = useAction();
  const toast = useToast();
  const loadKey = `${asset.id}:${initialMask?.id ?? ''}:${initialMaskEncoding}`;
  const [maskLoad, setMaskLoad] = useState<{
    key: string;
    status: 'loading' | 'ready' | 'failed';
    error?: string;
  }>({ key: loadKey, status: initialMask ? 'loading' : 'ready' });
  const awaitingBackgroundMask =
    purpose === 'background' &&
    !!initialMask &&
    (maskLoad.key !== loadKey || maskLoad.status !== 'ready');
  const editingDisabled = disabled || action.busy || awaitingBackgroundMask;
  const width = asset.width ?? 1024;
  const height = asset.height ?? 1024;
  const sourceKey = `${loadKey}:${width}:${height}:${purpose}`;
  const currentSourceKey = useRef(sourceKey);
  currentSourceKey.current = sourceKey;
  useEffect(
    () => () => {
      sourceVersion.current++;
    },
    [],
  );
  useEffect(() => {
    sourceVersion.current++;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.clearRect(0, 0, width, height);
    }
    setDirty(false);
    didDraw.current = false;
    resetBackgroundMaskSession(softSession.current);
    softImage.current = null;
    if (purpose === 'background') {
      active.current = false;
      previous.current = null;
      setMaskLoad({ key: loadKey, status: initialMask ? 'loading' : 'ready' });
    }
    if (!initialMask) {
      onMask(null);
      return;
    }
    // A grayscale candidate is not yet the user's transparent edit mask.
    onMask(purpose === 'background' || initialMaskEncoding === 'grayscale' ? null : initialMask);
    const image = new Image();
    let cancelled = false;
    const fail = (message: string) => {
      if (cancelled || purpose !== 'background') return;
      onMask(null);
      setDirty(false);
      setMaskLoad({ key: loadKey, status: 'failed', error: message });
    };
    image.onload = () => {
      if (cancelled || !canvasRef.current || (purpose !== 'background' && didDraw.current)) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx || image.naturalWidth !== width || image.naturalHeight !== height) {
        fail('背景区域蒙版尺寸与原图不一致，请关闭后重新打开；当前不能编辑或提交。');
        return;
      }
      try {
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, width, height);
        for (let n = 0; n < pixels.data.length; n += 4) {
          const editable =
            initialMaskEncoding === 'grayscale'
              ? Math.round((pixels.data[n]! + pixels.data[n + 1]! + pixels.data[n + 2]!) / 3)
              : 255 - pixels.data[n + 3]!;
          pixels.data[n] = pixels.data[n + 1] = pixels.data[n + 2] = 255;
          pixels.data[n + 3] = editable;
        }
        ctx.putImageData(pixels, 0, 0);
        if (purpose === 'background') {
          setMaskLoad({ key: loadKey, status: 'ready' });
          // A loaded candidate must still be explicitly saved before confirmation.
          setDirty(true);
        } else if (initialMaskEncoding === 'grayscale') setDirty(true);
      } catch {
        fail('背景区域蒙版加载失败，请关闭后重新打开；当前不能编辑或提交。');
      }
    };
    image.onerror = () => fail('背景区域蒙版加载失败，请关闭后重新打开；当前不能编辑或提交。');
    if (purpose === 'background') {
      // A failed or wrong-size response must not survive an explicit close/reopen retry.
      const url = new URL(initialMask.originalUrl, window.location.href);
      url.searchParams.set('_maskLoad', crypto.randomUUID());
      image.src = url.href;
    } else image.src = initialMask.originalUrl;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [asset.id, initialMask?.id, initialMaskEncoding, width, height, purpose]);
  function resetCoverage() {
    resetBackgroundMaskSession(softSession.current);
    softImage.current = null;
    active.current = false;
    previous.current = null;
  }
  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!active.current || editingDisabled || saving.current) return;
    didDraw.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const point = {
      x: ((event.clientX - box.left) * width) / box.width,
      y: ((event.clientY - box.top) * height) / box.height,
    };
    const context = canvas.getContext('2d');
    if (!context) return;
    context.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    context.lineWidth = (size * width) / box.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (purpose === 'background' && softness > 0) {
      const dirtyRect = moveBackgroundMaskGesture(softSession.current, point);
      if (dirtyRect && softImage.current)
        context.putImageData(
          softImage.current,
          0,
          0,
          dirtyRect.x,
          dirtyRect.y,
          dirtyRect.width,
          dirtyRect.height,
        );
    } else {
      context.strokeStyle = '#ffffff';
      context.beginPath();
      context.moveTo(previous.current?.x ?? point.x, previous.current?.y ?? point.y);
      context.lineTo(point.x + 0.1, point.y + 0.1);
      context.stroke();
    }
    previous.current = point;
    setDirty(true);
    onMask(null);
  }
  async function save() {
    if (editingDisabled || saving.current) return;
    saving.current = true;
    resetCoverage();
    const version = sourceVersion.current;
    const key = currentSourceKey.current;
    try {
      const applied = await action.run(async () => {
        const output = document.createElement('canvas');
        output.width = width;
        output.height = height;
        const ctx = output.getContext('2d');
        if (!ctx || !canvasRef.current) throw new Error('遮罩画板不可用');
        const painted = canvasRef.current.getContext('2d')?.getImageData(0, 0, width, height).data;
        if (!painted || !painted.some((value, index) => index % 4 === 3 && value > 0))
          throw new Error(
            t(
              purpose === 'erase'
                ? '请先涂画需要消除的区域，空遮罩不能提交。'
                : '请先涂画需要重绘的区域，空遮罩不能提交。',
            ),
          );
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(canvasRef.current, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        const blob = await new Promise<Blob>((resolve, reject) =>
          output.toBlob(
            (value) => (value ? resolve(value) : reject(new Error('遮罩导出失败'))),
            'image/png',
          ),
        );
        const uploaded = await uploadAsset<AssetDto>(
          new File([blob], `mask-${asset.id}.png`, { type: 'image/png' }),
        );
        // The upload may finish after a source change or this editor has unmounted.
        // Keep the uploaded asset, but never attach it to a different canvas.
        if (version !== sourceVersion.current || key !== currentSourceKey.current) return false;
        onMask(uploaded);
        setDirty(false);
        return true;
      });
      if (applied)
        toast(
          t(
            purpose === 'erase'
              ? '消除区域已保存'
              : purpose === 'background'
                ? '背景区域已保存'
                : '重绘区域已保存',
          ),
        );
    } finally {
      saving.current = false;
    }
  }
  return (
    <div className="mask-editor">
      {awaitingBackgroundMask && (
        <Notice
          tone={maskLoad.key === loadKey && maskLoad.status === 'failed' ? 'warning' : 'info'}
        >
          {t(
            maskLoad.key === loadKey && maskLoad.status === 'failed'
              ? maskLoad.error!
              : '正在加载背景区域蒙版…',
          )}
        </Notice>
      )}
      <div className="mask-toolbar">
        <Segments
          value={mode}
          onChange={(next) => {
            if (editingDisabled || next === mode) return;
            if (purpose === 'background') resetCoverage();
            setMode(next);
          }}
          options={[
            { value: 'brush', label: '画笔' },
            { value: 'erase', label: '橡皮' },
          ]}
        />
        <Button
          variant="ghost"
          disabled={editingDisabled}
          onClick={() => {
            canvasRef.current?.getContext('2d')?.clearRect(0, 0, width, height);
            onMask(null);
            setDirty(false);
            resetCoverage();
            didDraw.current = true;
          }}
        >
          <RotateCcw size={14} />
          {t('清空')}
        </Button>
      </div>
      <Field label={`${t('画笔大小')} · ${size}`}>
        <input
          type="range"
          min={purpose === 'background' ? 1 : 5}
          max={100}
          value={size}
          disabled={editingDisabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (next === size) return;
            if (purpose === 'background') resetCoverage();
            setSize(next);
          }}
        />
      </Field>
      {purpose === 'background' && (
        <Field label={`${t('边缘柔和度')} · ${softness}%`}>
          <input
            type="range"
            min={0}
            max={100}
            value={softness}
            disabled={editingDisabled}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (next === softness) return;
              resetCoverage();
              setSoftness(next);
            }}
          />
        </Field>
      )}
      {purpose === 'background' && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preventAccumulation}
              disabled={editingDisabled}
              onChange={(event) => {
                resetCoverage();
                setPreventAccumulation(event.target.checked);
              }}
            />
            {t('柔边不叠加')}
          </label>
          <p className="field-hint">
            {t(
              '同一工具、大小和柔度下，分段与回描不叠加；换参数或保存后重新开始。关闭后按笔叠加。',
            )}
          </p>
        </>
      )}
      <div
        className="mask-stage"
        style={{
          aspectRatio: `${width}/${height}`,
          ...(purpose === 'background' ? { maxWidth: `${(500 * width) / height}px` } : {}),
          backgroundImage: `url("${asset.previewUrl ?? asset.originalUrl}")`,
        }}
      >
        <canvas
          ref={canvasRef}
          aria-disabled={purpose === 'background' ? editingDisabled : undefined}
          aria-busy={awaitingBackgroundMask || undefined}
          onPointerDown={(event) => {
            if (editingDisabled || saving.current) return;
            active.current = true;
            previous.current = null;
            if (purpose === 'background' && softness > 0) {
              const context = event.currentTarget.getContext('2d');
              if (!context) return;
              beginBackgroundMaskGesture(
                softSession.current,
                () => {
                  softImage.current = context.getImageData(0, 0, width, height);
                  return softImage.current.data;
                },
                {
                  width,
                  height,
                  mode,
                  radius: (size * width) / event.currentTarget.getBoundingClientRect().width / 2,
                  softness,
                  preventAccumulation,
                },
              );
            } else {
              resetBackgroundMaskSession(softSession.current);
              softImage.current = null;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            draw(event);
          }}
          onPointerMove={draw}
          onPointerUp={() => {
            active.current = false;
            previous.current = null;
            endBackgroundMaskGesture(softSession.current);
            if (!softSession.current.stroke) softImage.current = null;
          }}
          onPointerCancel={() => {
            active.current = false;
            previous.current = null;
            endBackgroundMaskGesture(softSession.current);
            if (!softSession.current.stroke) softImage.current = null;
          }}
          aria-label={t(
            purpose === 'erase'
              ? '在原图上涂画需要消除的物体'
              : purpose === 'background'
                ? '在原图上调整需要替换的背景区域'
                : '在原图上涂画需要重绘的区域',
          )}
        />
      </div>
      <p className="field-hint">
        {t(
          purpose === 'erase'
            ? '白色涂画区域中的物体将被移除。蒙版按原图尺寸保存。'
            : purpose === 'background'
              ? '白色覆盖区替换背景；橡皮恢复原图保护区。请检查主体、台面和阴影，软边用于自然过渡。'
              : '白色涂画区域将被修改。遮罩按原图尺寸保存。',
        )}
      </p>
      <Button
        variant="secondary"
        disabled={!dirty || editingDisabled}
        busy={action.busy}
        onClick={() => void save()}
      >
        <Save size={14} />
        {t(
          purpose === 'erase'
            ? '保存消除区域'
            : purpose === 'background'
              ? '保存背景区域'
              : '保存重绘区域',
        )}
      </Button>
    </div>
  );
}
