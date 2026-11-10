import { t } from '../lib/i18n';
import { Notice } from './ui';

/** A failed planning run remains historical after its outputs are explicitly recovered. */
export function DetailPagePlanningNotice({
  recovered,
  failed,
  hasGeneration,
  failureMessage,
}: {
  recovered: boolean;
  failed: boolean;
  hasGeneration: boolean;
  failureMessage?: string | null;
}) {
  if (recovered)
    return (
      <Notice>
        <strong>{t('已采用修复校验后的原方案')}</strong>
        <p>
          {t('原策划失败记录已保留，本次方案恢复未重新调用策划模型。')}
          {!hasGeneration && t('请核对各屏和商品事实，图片生成仍需另行确认报价。')}
        </p>
      </Notice>
    );
  if (!failed) return null;
  if (hasGeneration)
    return (
      <Notice>
        <strong>{t('原策划运行未完成')}</strong>
        <p>{t('原始失败原因保留在任务中心，已提交的图片任务独立展示在下方。')}</p>
      </Notice>
    );
  return (
    <Notice tone="warning">
      <strong>{t('策划暂未完成')}</strong>
      <p>{failureMessage || t('请检查商品简报与服务状态后重新策划。')}</p>
    </Notice>
  );
}

export function DetailPageUnknowns({
  unknowns,
  expanded,
}: {
  unknowns: string[];
  expanded: boolean;
}) {
  if (!unknowns.length) return null;
  return (
    <details className="detail-unknowns" open={expanded}>
      <summary>
        {t('待核对信息')} · {unknowns.length} {t('项')}
      </summary>
      <p>{t('这些待核对项仍然保留；图片生成完成不代表商品事实已经确认。')}</p>
      <ul>
        {unknowns.map((unknown, index) => (
          <li key={index}>{unknown}</li>
        ))}
      </ul>
    </details>
  );
}
