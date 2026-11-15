import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  localTestGrantInputSchema,
  type LocalTestGrantAvailabilityDto,
  type LocalTestGrantInput,
  type LocalTestGrantResultDto,
} from '../../contracts/local-test-credits';
import { useStudio } from '../context';
import { api, errorMessage, useApi, useRefresh } from '../lib/api';
import { t } from '../lib/i18n';
import { Button, Field, Modal, useToast } from './ui';

export function LocalTestCredits() {
  const { isAdmin, workspace, session } = useStudio();
  const permission = useApi<LocalTestGrantAvailabilityDto>('/credits/local-test-grant', isAdmin);
  if (!permission.data?.available || !workspace || !session) return null;
  return (
    <GrantControl
      key={`${session.user.id}:${workspace.id}`}
      userId={session.user.id}
      workspaceId={workspace.id}
      maximum={permission.data.maxCredits}
    />
  );
}

function GrantControl({
  userId,
  workspaceId,
  maximum,
}: {
  userId: string;
  workspaceId: string;
  maximum: number;
}) {
  const storageKey = `yingzao:local-test-grant:v1:${userId}:${workspaceId}`;
  const [recovery] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return {
        pending: saved ? localTestGrantInputSchema.parse(JSON.parse(saved)) : null,
        error: null,
      };
    } catch {
      return { pending: null, error: t('无法读取本机额度记录，请检查浏览器存储后重试。') };
    }
  });
  const [pending, setPending] = useState<LocalTestGrantInput | null>(recovery.pending);
  const [amount, setAmount] = useState(String(recovery.pending?.amount ?? 1000));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(recovery.error);
  const active = useRef(false);
  const refresh = useRefresh();
  const toast = useToast();

  async function submit() {
    if (active.current || recovery.error) return;
    const request = pending ?? { amount: Number(amount), requestId: crypto.randomUUID() };
    if (!localTestGrantInputSchema.safeParse(request).success || request.amount > maximum) {
      setError(t('请输入允许范围内的正整数积分。'));
      return;
    }
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      // A lost response must remain retryable with the same ID, including after reload.
      localStorage.setItem(storageKey, JSON.stringify(request));
      setPending(request);
      const result = await api<LocalTestGrantResultDto>(
        '/credits/local-test-grant',
        {
          method: 'POST',
          body: JSON.stringify(request),
          timeoutMs: 15000,
        },
        workspaceId,
      );
      await refresh();
      try {
        localStorage.removeItem(storageKey);
      } catch {
        setError(t('额度已入账，但本机记录清理失败；请核对此次增加，不要另建请求。'));
        return;
      }
      setPending(null);
      setAmount('1000');
      setOpen(false);
      toast(
        result.alreadyApplied
          ? t('已核对此次增加，额度未重复入账。')
          : t('已增加 {amount} 测试积分。').replace('{amount}', String(result.granted)),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={16} />
        {t('增加测试额度')}
      </Button>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t('增加测试额度')}
        description={t('增加当前空间的项目内部积分，不是现金或模型服务商余额。')}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field
            label={t('增加积分')}
            hint={t('仅用于本机开发测试，不会发起付款或为外部服务充值。')}
          >
            <input
              type="number"
              required
              min={1}
              max={maximum}
              step={1}
              value={amount}
              disabled={busy || !!pending}
              onChange={(event) => {
                setAmount(event.target.value);
                setError(null);
              }}
            />
          </Field>
          {pending && (
            <p className="field-hint">
              {t('已有一次增加请求待核对，继续操作会使用同一编号，避免重复入账。')}
            </p>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button type="submit" busy={busy} disabled={!!recovery.error}>
              {t(pending ? '核对此次增加' : '确认增加')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
