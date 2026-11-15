import { ExportPolicySchema, type ExportPolicy } from '../../contracts/export-policy';

/** Application export decoration, not an access control or tamper-proof DRM mechanism. */
export function applyExportWatermark(canvas: HTMLCanvasElement, rawPolicy?: ExportPolicy) {
  if (!rawPolicy) return;
  const policy = ExportPolicySchema.parse(rawPolicy);
  if (!policy.watermark) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable for export watermark');
  const { width, height } = canvas;
  const { text, opacity } = policy.watermark;
  // Layout in final output pixels so cropped selections, scaled exports and ZIP entries agree.
  const margin = Math.min(24, Math.max(0, Math.min(width, height) * 0.025));
  const availableWidth = Math.max(0.1, width - margin * 2);
  let fontSize = Math.min(48, Math.max(12, Math.min(width, height) * 0.035));
  const setFont = () => {
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  };
  ctx.save();
  try {
    setFont();
    const initialWidth = ctx.measureText(text).width + fontSize * 1.3;
    fontSize *= Math.min(
      1,
      availableWidth / Math.max(1, initialWidth),
      Math.max(0.1, height - margin * 2) / (fontSize * 1.8),
    );
    setFont();
    const padding = fontSize * 0.65;
    const boxWidth = Math.min(availableWidth, ctx.measureText(text).width + padding * 2);
    const boxHeight = Math.min(height, fontSize * 1.8);
    const x = Math.max(0, width - margin - boxWidth);
    const y = Math.max(0, height - margin - boxHeight);
    ctx.globalAlpha = opacity;
    ctx.fillStyle = '#111827';
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padding, y + boxHeight / 2, Math.max(0.1, boxWidth - padding * 2));
  } finally {
    ctx.restore();
  }
}
export function exportPolicyManifest(rawPolicy?: ExportPolicy) {
  if (!rawPolicy)
    return {
      scope: 'application-exports',
      status: 'no-server-policy-provided',
      applied: false,
      enforcement:
        'Application rendering only; originals and client-side modification are outside this policy.',
    };
  const policy = ExportPolicySchema.parse(rawPolicy);
  return {
    ...policy,
    applied: policy.watermark !== null,
    enforcement:
      'Application rendering only; originals and client-side modification are outside this policy.',
  };
}
