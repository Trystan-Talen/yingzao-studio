import { ArrowUpRight } from 'lucide-react';
import { useApi } from '../lib/api';
import { t } from '../lib/i18n';
import { Notice } from './ui';

const demoGenerationReason = '演示模式不调用自定义模型，请在正式模式配置并生成';

export function isDemoGenerationBlocked(reason: string | null | undefined) {
  return reason === demoGenerationReason;
}

/** Only the documented local preview has a known, separate real-mode address. */
export function localRealModeSettingsUrl(origin: string) {
  return origin === 'http://127.0.0.1:5174' || origin === 'http://localhost:5174'
    ? 'http://127.0.0.1:5176/settings?tab=models'
    : undefined;
}

export function DemoModeGenerationNotice({ confirmedDemo }: { confirmedDemo?: boolean }) {
  const health = useApi<{ demoMode: boolean }>('/health', confirmedDemo === undefined);
  if (!(confirmedDemo ?? health.data?.demoMode)) return null;
  const realModeUrl = localRealModeSettingsUrl(
    typeof window === 'undefined' ? '' : window.location.origin,
  );
  return (
    <section aria-label={t('演示模式生成说明')}>
      <Notice tone="warning">
        <strong>{t(demoGenerationReason)}</strong>
        <p>{t('真实生成模式使用独立的账号、模型配置与数据；演示配置不会自动迁移。')}</p>
        {realModeUrl ? (
          <>
            <p>{t('这是本机的独立入口，不是线上环境。')}</p>
            <a href={realModeUrl} target="_blank" rel="noreferrer">
              {t('打开本机真实生成')} <ArrowUpRight size={12} />
            </a>
          </>
        ) : (
          <p>{t('请联系管理员提供正式模式入口。')}</p>
        )}
      </Notice>
    </section>
  );
}
