import { t } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import type { AssetDto } from '../../contracts/core';
import { uploadAsset } from '../lib/api';
import { Button, Field, Segments, useAction } from './ui';
export function MaskEditor({
  asset,
  onMask,
}: {
  asset: AssetDto;
  onMask: (mask: AssetDto | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const active = useRef(false);
  const previous = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<'brush' | 'erase'>('brush');
  const [size, setSize] = useState(30);
  const [dirty, setDirty] = useState(false);
  const action = useAction();
  const width = asset.width ?? 1024;
  const height = asset.height ?? 1024;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.clearRect(0, 0, width, height);
    }
    setDirty(false);
    onMask(null);
  }, [asset.id]);
  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!active.current) return;
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
    context.strokeStyle = '#ffffff';
    context.beginPath();
    context.moveTo(previous.current?.x ?? point.x, previous.current?.y ?? point.y);
    context.lineTo(point.x + 0.1, point.y + 0.1);
    context.stroke();
    previous.current = point;
    setDirty(true);
    onMask(null);
  }
  async function save() {
    await action.run(async () => {
      const output = document.createElement('canvas');
      output.width = width;
      output.height = height;
      const ctx = output.getContext('2d');
      if (!ctx || !canvasRef.current) throw new Error('遮罩画板不可用');
      const painted = canvasRef.current.getContext('2d')?.getImageData(0, 0, width, height).data;
      if (!painted || !painted.some((value, index) => index % 4 === 3 && value > 0))
        throw new Error(t('请先涂画需要重绘的区域，空遮罩不能提交。'));
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
      onMask(uploaded);
      setDirty(false);
    }, '重绘区域已保存');
  }
  return (
    <div className="mask-editor">
      <div className="mask-toolbar">
        <Segments
          value={mode}
          onChange={setMode}
          options={[
            { value: 'brush', label: '画笔' },
            { value: 'erase', label: '橡皮' },
          ]}
        />
        <Button
          variant="ghost"
          onClick={() => {
            canvasRef.current?.getContext('2d')?.clearRect(0, 0, width, height);
            onMask(null);
            setDirty(false);
          }}
        >
          <RotateCcw size={14} />
          {t('清空')}
        </Button>
      </div>
      <Field label={`${t('画笔大小')} · ${size}`}>
        <input
          type="range"
          min={5}
          max={100}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        />
      </Field>
      <div
        className="mask-stage"
        style={{
          aspectRatio: `${width}/${height}`,
          backgroundImage: `url("${asset.previewUrl ?? asset.originalUrl}")`,
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={(event) => {
            active.current = true;
            previous.current = null;
            event.currentTarget.setPointerCapture(event.pointerId);
            draw(event);
          }}
          onPointerMove={draw}
          onPointerUp={() => {
            active.current = false;
            previous.current = null;
          }}
          onPointerCancel={() => {
            active.current = false;
          }}
          aria-label={t('在原图上涂画需要重绘的区域')}
        />
      </div>
      <p className="field-hint">{t('白色涂画区域将被修改。遮罩按原图尺寸保存。')}</p>
      <Button variant="secondary" disabled={!dirty} busy={action.busy} onClick={() => void save()}>
        <Save size={14} />
        {t('保存重绘区域')}
      </Button>
    </div>
  );
}
