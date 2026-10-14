import { t } from '../lib/i18n';
import { useState } from 'react';
import type { AssetDto } from '../../contracts/core';
import type { JobDto } from '../../contracts/jobs';
import { post, useRefresh } from '../lib/api';
import { AssetPicker } from './AssetPicker';
import { Button, Field, Modal, Notice, useAction } from './ui';
export function TaskReconcile({ job }: { job: JobDto }) {
  const textOnly = ['text.assist', 'image.ocr'].includes(job.operation);
  const resultKind =
    job.operation.startsWith('video.') ||
    job.operation === 'video-replica' ||
    job.operation === 'local.video-trim'
      ? 'video'
      : 'image';
  const [open, setOpen] = useState(false);
  const unresolved = job.items.filter((item) => item.status === 'reconciliation_required');
  const [itemId, setItemId] = useState(unresolved[0]?.id ?? '');
  const [outcome, setOutcome] = useState('failed');
  const [evidence, setEvidence] = useState('');
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [text, setText] = useState('');
  const action = useAction();
  const refresh = useRefresh();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('核对服务商结果')}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('核对服务商结果')}
        description={t('仅在实际检查供应商记录后操作。不能根据等待时间猜测成功或失败。')}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await post(`/jobs/${job.id}/reconcile`, {
                itemId,
                outcome,
                evidence,
                ...(outcome === 'succeeded' && !textOnly && assets.length
                  ? { assetIds: assets.map((a) => a.id) }
                  : {}),
                ...(outcome === 'succeeded' && textOnly && text.trim()
                  ? { resultText: text.trim() }
                  : {}),
              });
              setOpen(false);
              await refresh();
            }, '核对结果已保存');
          }}
        >
          <Notice tone="warning">
            {t('确认成功会结算对应额度；确认失败会释放预留。证据与管理员操作会保留为审计记录。')}
          </Notice>
          <Field label={t('待核对条目')}>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {unresolved.map((item) => (
                <option key={item.id} value={item.id}>
                  {t('第')}
                  {item.index + 1}
                  {t('项 ·')}
                  {item.remoteId ?? '无远端编号'}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('已核实的结果')}>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="failed">{t('供应商已确认失败 / 未执行')}</option>
              <option value="succeeded">{t('供应商已确认成功')}</option>
            </select>
          </Field>
          {outcome === 'succeeded' && (
            <>
              {!textOnly && (
                <AssetPicker
                  value={assets}
                  onChange={setAssets}
                  kind={resultKind}
                  max={job.operation === 'image.layers' ? 10 : 1}
                  label={
                    job.operation === 'image.layers'
                      ? t('实际图层结果（按层级顺序）')
                      : t('实际结果素材')
                  }
                />
              )}
              {textOnly && (
                <Field label={t('真实文字结果（文字任务）')}>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={50000}
                    rows={3}
                  />
                </Field>
              )}
            </>
          )}
          <Field
            label={t('核对证据')}
            hint={t('至少10个字，记录供应商任务编号、查询结果与核对依据。')}
          >
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              minLength={10}
              required
              rows={4}
            />
          </Field>
          <div className="modal-actions">
            <Button
              type="submit"
              busy={action.busy}
              disabled={
                !itemId ||
                evidence.trim().length < 10 ||
                (outcome === 'succeeded' && (textOnly ? !text.trim() : !assets.length))
              }
            >
              {t('保存核对结果')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
