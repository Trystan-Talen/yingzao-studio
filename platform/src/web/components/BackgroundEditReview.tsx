import { useRef, useState } from 'react';
import type { AssetDto } from '../../contracts/core';
import type { BackgroundReviewDetail } from '../../contracts/background-review';
import type { CreativePreparation } from '../../contracts/creative-intent';
import { post, useApi } from '../lib/api';
import type { Job, Quote } from '../lib/tasks';
import { MaskEditor } from './MaskEditor';
import { JobSubmit } from './JobSubmit';
import { Modal, Notice, Loading, ErrorState } from './ui';
import { t } from '../lib/i18n';
import '../styles/background-review.css';

export function BackgroundEditReview({
  job,
  itemId,
  onClose,
  onCreated,
}: {
  job: Job;
  itemId: string;
  onClose: () => void;
  onCreated: (job: Job) => void;
}) {
  const base = `/jobs/${job.id}/items/${itemId}/background-review`;
  const query = useApi<BackgroundReviewDetail>(base);
  const [mask, setMask] = useState<AssetDto | null>(null);
  const requests = useRef(new Map<string, string>());
  const detail = query.data;
  return (
    <Modal
      open
      onClose={onClose}
      title={t('调整背景区域')}
      description={t('核对并修正区域后仅在本机合成，不调用模型，原候选保留。')}
      wide
    >
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        detail && (
          <>
            <Notice>
              {t('自动蒙版是待核对候选。请检查主体轮廓、台面、阴影和所有边缘，保存确认后的区域。')}{' '}
              {t('背景颜色')}：{detail.color} · {t('本次本机合成')} 0 {t('积分')}
            </Notice>
            <MaskEditor
              asset={detail.source}
              initialMask={detail.mask}
              initialMaskEncoding="grayscale"
              purpose="background"
              onMask={setMask}
            />
            <div className="background-review-submit">
              <JobSubmit
                key={mask?.id ?? 'unsaved'}
                forceConfirmation
                valid={!!mask}
                input={{ ...job.input, maskAssetId: mask?.id }}
                recoveryScope={`background:${job.id}:${itemId}:${mask?.id ?? 'unsaved'}`}
                label="确认区域并本机合成"
                operation={{
                  id: 'image.generate',
                  name: '背景区域本机合成',
                  providerId: 'native',
                  available: true,
                  reason: null,
                  models: [],
                  priceCredits: 0,
                  unit: 'request',
                  liveVerified: false,
                }}
                quoteFactory={async () => {
                  if (!mask) throw new Error(t('请先保存确认的背景区域。'));
                  let requestId = requests.current.get(mask.id);
                  if (!requestId) {
                    requestId = crypto.randomUUID();
                    requests.current.set(mask.id, requestId);
                  }
                  const prepared = await post<CreativePreparation>(`${base}/prepare`, {
                    requestId,
                    maskAssetId: mask.id,
                  });
                  const quote = await post<Quote>('/quotes', prepared.input);
                  if (quote.maxCredits !== 0)
                    throw new Error(t('本机修正报价不是0积分，已停止，请核对。'));
                  return { input: prepared.input, quote };
                }}
                onCreated={(created) => {
                  onCreated(created);
                  onClose();
                }}
              />
            </div>
          </>
        )
      )}
    </Modal>
  );
}
