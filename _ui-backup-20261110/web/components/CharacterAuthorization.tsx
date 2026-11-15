import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { t } from '../lib/i18n';
import { api, dateTime, post, useApi, useRefresh } from '../lib/api';
import { useStudio } from '../context';
import { Badge, Button, ErrorState, Field, Loading, Modal, Notice, useAction } from './ui';
interface Authorization {
  status: 'not-declared' | 'active' | 'withdrawn' | 'stale';
  referenceRevision: number;
  statementVersion: 'reference-use-v1';
  authorizedAt: string | null;
  withdrawnAt: string | null;
  subjectRelationship: 'self' | 'authorized-representative' | null;
}
const labels = {
  'not-declared': '未声明授权',
  active: '已声明参考授权',
  withdrawn: '授权已撤回',
  stale: '参考素材已更新，需重新声明',
};
export function CharacterAuthorization({ characterId }: { characterId: string }) {
  const { canEdit } = useStudio();
  const action = useAction();
  const refresh = useRefresh();
  const query = useApi<Authorization>(`/characters/${characterId}/authorization`);
  const verification = useApi<{ configured: boolean; reason: string; sessions: unknown[] }>(
    `/characters/${characterId}/verification`,
  );
  const [relationship, setRelationship] = useState<'self' | 'authorized-representative'>('self');
  const [ack, setAck] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <section className="section-spaced">
      <div className="section-heading">
        <h3>{t('人物参考授权')}</h3>
        {query.data && (
          <Badge tone={query.data.status === 'active' ? 'green' : 'neutral'}>
            {t(labels[query.data.status])}
          </Badge>
        )}
      </div>
      <Notice>
        {t(
          '这是对当前参考素材使用权的自述声明，只用于普通人物参考，不等同于实名认证、活体检测或身份核验。',
        )}
      </Notice>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : (
        query.data && (
          <>
            <p className="muted">
              {t('参考素材版本')} {query.data.referenceRevision} · {t('声明版本')}{' '}
              {query.data.statementVersion}
            </p>
            {query.data.authorizedAt && (
              <p className="muted">
                {t('声明时间')} {dateTime(query.data.authorizedAt)}
              </p>
            )}
            {query.data.status === 'active' ? (
              <Button
                type="button"
                variant="ghost"
                disabled={!canEdit}
                onClick={() => setWithdraw(true)}
              >
                {t('撤回参考授权')}
              </Button>
            ) : (
              <>
                <Field label={t('你与人物的关系')}>
                  <select
                    disabled={!canEdit}
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value as typeof relationship)}
                  >
                    <option value="self">{t('人物为本人')}</option>
                    <option value="authorized-representative">{t('我已获得本人授权')}</option>
                  </select>
                </Field>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={ack}
                    disabled={!canEdit}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  {t(
                    '我确认有权将当前参考素材用于创作，已获得素材中人物所需的授权，并了解这项声明不代表身份认证。',
                  )}
                </label>
                <Button
                  type="button"
                  disabled={!canEdit || !ack}
                  busy={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await post(`/characters/${characterId}/authorization`, {
                        acknowledged: true,
                        statementVersion: 'reference-use-v1',
                        subjectRelationship: relationship,
                      });
                      setAck(false);
                      await refresh();
                    }, '参考授权声明已保存')
                  }
                >
                  <ShieldCheck size={16} />
                  {t('保存授权声明')}
                </Button>
              </>
            )}
          </>
        )
      )}
      <h3 className="section-spaced">{t('身份核验')}</h3>
      <Notice>
        {verification.data?.reason
          ? t(verification.data.reason)
          : t('身份核验需要单独的服务与有效核验记录。参考授权不会把人物标记为已认证。')}
      </Notice>
      {verification.error && <ErrorState error={verification.error} retry={verification.refetch} />}
      <Button
        type="button"
        variant="secondary"
        disabled={!canEdit || !verification.data?.configured}
        busy={action.busy}
        onClick={() =>
          void action.run(async () => {
            await post(`/characters/${characterId}/verification/start`, {});
            await verification.refetch();
          })
        }
      >
        {verification.data?.configured ? t('开始身份核验') : t('身份核验服务未连接')}
      </Button>
      <Modal
        open={withdraw}
        onClose={() => setWithdraw(false)}
        title={t('撤回人物参考授权')}
        description={t('撤回记录会保留。此操作不会删除已有作品或原始素材。')}
      >
        <Field label={t('撤回原因')}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </Field>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={() => setWithdraw(false)}>
            {t('取消')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!reason.trim()}
            busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api(`/characters/${characterId}/authorization`, {
                  method: 'DELETE',
                  body: JSON.stringify({ reason }),
                });
                setWithdraw(false);
                setReason('');
                await refresh();
              }, '参考授权已撤回')
            }
          >
            {t('确认撤回')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
