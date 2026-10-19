import { t } from '../lib/i18n';
import { useState } from 'react';
import type { AssetDto } from '../../contracts/core';
import { parseSocialVideoLink } from '../../contracts/social-import';
import { useStudio } from '../context';
import { qs, useApi, type Page } from '../lib/api';
import { jobInput, statusLabels, type Capabilities, type Job } from '../lib/tasks';
import { JobSubmit } from './JobSubmit';
import { Button, ErrorState, Field, Loading, Notice } from './ui';

/** The regular task journal owns submission and recovery; importing never starts generation. */
export function SocialVideoImport({
  projectId,
  onSelect,
  disabled,
}: {
  projectId?: string;
  onSelect: (asset: AssetDto) => void;
  disabled: boolean;
}) {
  const { session } = useStudio();
  const [text, setText] = useState('');
  const [rights, setRights] = useState(false);
  const [cost, setCost] = useState(false);
  const [page, setPage] = useState(1);
  const capabilities = useApi<Capabilities>('/capabilities');
  const history = useApi<Page<Job>>(
    `/jobs${qs({ operation: 'media.import', createdBy: session?.user.id, pageSize: 5, page })}`,
    true,
    4000,
  );
  let url = '',
    error = '';
  try {
    url = parseSocialVideoLink(text).url;
  } catch (e) {
    if (text.trim()) error = e instanceof Error ? e.message : '链接无法识别。';
  }
  const input = jobInput({
    operation: 'media.import',
    providerId: 'tikhub',
    projectId,
    linkUrl: url,
    options: { referenceAuthorized: rights, externalCostAccepted: cost },
  });
  const operation = capabilities.data?.operations.find((item) => item.id === 'media.import');
  return (
    <section className="section-spaced">
      <Notice>
        {t(
          '支持抖音和 TikTok（国际版抖音）公开视频，导入后可用于视频创作或编辑。最多 100 MiB（兆字节）。小红书视频暂不支持链接导入，请上传文件。',
        )}
      </Notice>
      <Field
        label={t('视频分享链接')}
        hint={t('可粘贴包含一个链接的分享文字；不支持登录后才能查看的内容。')}
      >
        <textarea
          value={text}
          maxLength={4096}
          onChange={(event) => {
            setText(event.target.value);
            setCost(false);
            setRights(false);
          }}
          rows={3}
        />
      </Field>
      {error && <Notice tone="warning">{error}</Notice>}
      <label className="check-row">
        <input
          type="checkbox"
          checked={rights}
          onChange={(event) => setRights(event.target.checked)}
        />
        {t('我有权下载并使用这段视频')}
      </label>
      <label className="check-row">
        <input type="checkbox" checked={cost} onChange={(event) => setCost(event.target.checked)} />
        {t('我确认解析服务按调用另行收费，失效链接或下载失败也可能收费')}
      </label>
      {capabilities.isLoading ? (
        <Loading />
      ) : capabilities.error ? (
        <ErrorState error={capabilities.error} retry={capabilities.refetch} />
      ) : (
        <JobSubmit
          input={input}
          operation={operation}
          valid={!!url && !error && rights && cost && !disabled}
          forceConfirmation
          label={t('确认导入视频')}
          recoveryScope={`media.import:${projectId ?? 'library'}`}
          onCreated={() => {
            setText('');
            setRights(false);
            setCost(false);
            setPage(1);
            void history.refetch();
          }}
        />
      )}
      <h3>{t('我的最近导入')}</h3>
      <p className="muted">
        {t(
          '提交后可以关闭窗口；刷新或重新打开仍可查看任务和选用结果。连接中断时，先核对原任务，避免重复解析。',
        )}
      </p>
      {history.error ? (
        <ErrorState error={history.error} retry={history.refetch} />
      ) : history.isLoading ? (
        <Loading />
      ) : !history.data?.items.length ? (
        <p className="muted">{t('还没有导入任务。')}</p>
      ) : (
        history.data.items.map((job) => (
          <div className="panel section-spaced" key={job.id}>
            <strong>{t(statusLabels[job.status] ?? job.status)}</strong>
            <small className="muted"> · {new Date(job.createdAt).toLocaleString()}</small>
            {job.errorMessage && <p role="status">{job.errorMessage}</p>}
            {job.status === 'reconciliation_required' && (
              <Notice tone="warning">
                {t('请在任务中心核对服务商记录。这里不会自动重新解析。')}
              </Notice>
            )}
            {job.outputAssets.map((asset) => (
              <div key={asset.id}>
                <span>{asset.name}</span>{' '}
                <Button
                  variant="secondary"
                  disabled={disabled || asset.kind !== 'video'}
                  onClick={() => onSelect(asset)}
                >
                  {t('选用视频')}
                </Button>
              </div>
            ))}
          </div>
        ))
      )}
      <div className="toolbar">
        <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>
          {t('上一页')}
        </Button>
        <span>{page}</span>
        <Button
          variant="ghost"
          disabled={!history.data || page * 5 >= history.data.total}
          onClick={() => setPage(page + 1)}
        >
          {t('下一页')}
        </Button>
      </div>
    </section>
  );
}
