import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssetDto } from '../../contracts/core';
import { ocrResultSchema } from '../../contracts/ocr';
import { useApi } from '../lib/api';
import { t } from '../lib/i18n';
import { ErrorState, Loading, Notice } from './ui';
export function parseOcrResult(text: string) {
  try {
    const result = ocrResultSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function OCRResultPanel({
  text,
  jobId,
  itemId,
}: {
  text: string;
  jobId: string;
  itemId: string;
}) {
  const result = parseOcrResult(text);
  const [selected, setSelected] = useState(0);
  const asset = useApi<AssetDto>(`/assets/${result?.imageAssetId ?? ''}`, !!result);
  if (!result) return <pre>{text}</pre>;
  return (
    <section className="ocr-result">
      <Notice>
        {t('文字与框选区域为模型识别建议，坐标按原图像素记录。提交改字前请核对内容和位置。')}
      </Notice>
      {asset.isLoading ? (
        <Loading />
      ) : asset.error ? (
        <ErrorState error={asset.error} retry={asset.refetch} />
      ) : (
        asset.data && (
          <div
            className="ocr-preview"
            style={{
              aspectRatio: `${result.imageWidth}/${result.imageHeight}`,
              width: `min(100%, ${(520 * result.imageWidth) / result.imageHeight}px)`,
            }}
          >
            <img src={asset.data.previewUrl ?? asset.data.originalUrl} alt={asset.data.name} />
            {result.regions.map((region, index) => (
              <button
                type="button"
                key={index}
                className={selected === index ? 'selected' : ''}
                aria-label={`${t('选择文字区域')} ${index + 1}: ${region.text}`}
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
                style={{
                  left: `${(region.rect[0] / result.imageWidth) * 100}%`,
                  top: `${(region.rect[1] / result.imageHeight) * 100}%`,
                  width: `${(region.rect[2] / result.imageWidth) * 100}%`,
                  height: `${(region.rect[3] / result.imageHeight) * 100}%`,
                }}
              >
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
        )
      )}
      <ol className="ocr-regions">
        {result.regions.map((region, index) => (
          <li key={index}>
            <button
              type="button"
              aria-pressed={selected === index}
              className={selected === index ? 'selected' : ''}
              onClick={() => setSelected(index)}
            >
              {region.text || t('空文字区域')}
              <small>{region.rect.join(', ')}</small>
            </button>
          </li>
        ))}
      </ol>
      {!!result.regions.length && (
        <Link
          className="button secondary"
          to={`/advanced/image.text-edit?ocrJobId=${encodeURIComponent(jobId)}&ocrItemId=${encodeURIComponent(itemId)}&region=${selected}`}
        >
          {t('用所选区域创建改字草稿')}
        </Link>
      )}
    </section>
  );
}
