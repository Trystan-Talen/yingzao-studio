import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TeamCreationStatus } from '../../contracts/team-creation';
import type { WorkspaceDto } from '../../contracts/core';
import { api, money, post, useApi } from '../lib/api';
import { t } from '../lib/i18n';
import { useStudio } from '../context';
import { Button, ErrorState, Field, Loading, Modal, Notice, useAction } from './ui';

export function TeamCreation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refreshSession, switchWorkspace } = useStudio();
  const navigate = useNavigate(),
    action = useAction();
  const state = useApi<TeamCreationStatus>('/team-creation', open);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const data = state.data;
  async function enter(wid: string) {
    await refreshSession();
    await switchWorkspace(wid);
    onClose();
    navigate('/team');
  }
  const pending = data?.pending,
    order = pending?.order;
  const waiting = !!order && ['draft', 'pending', 'paid'].includes(order.status);
  const plan = data?.plans.find((p) => p.id === selected);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('创建团队空间')}
      description={t('每个账号限一个团队；付款核验后开放项目、素材与成员。')}
    >
      {state.isLoading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState error={state.error} retry={state.refetch} />
      ) : (
        data && (
          <>
            <Notice>{t(data.reason)}</Notice>
            {data.mode === 'existing' && data.existing ? (
              <div className="modal-actions">
                {data.existing.accessible ? (
                  <Button
                    busy={action.busy}
                    onClick={() => void action.run(() => enter(data.existing!.id))}
                  >
                    {t('进入已有团队')} · {data.existing.name}
                  </Button>
                ) : (
                  <Notice>
                    {t(
                      data.existing.archived
                        ? '原团队已解散，账号名额仍保留。'
                        : '原团队已转让且当前没有访问权限，请联系团队管理员。',
                    )}
                  </Notice>
                )}
              </div>
            ) : data.mode === 'demo' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(async () => {
                    const result = await post<WorkspaceDto>('/workspaces', { name });
                    await state.refetch();
                    await enter(result.id);
                  });
                }}
              >
                <Field label={t('团队名称')}>
                  <input
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <div className="modal-actions">
                  <Button busy={action.busy} type="submit">
                    {t('创建本机演示团队')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                {order && (
                  <div className="panel">
                    <strong>{pending!.name}</strong>
                    <p>
                      {order.number} · {money(order.amountMinor, order.currency)}
                    </p>
                    <Notice>
                      {t(
                        order.status === 'draft'
                          ? '订单草稿已保存，尚未付款或开通团队。'
                          : order.status === 'pending'
                            ? '付款结果待核对；继续使用原订单，不会创建第二个团队。'
                            : order.status === 'refunded'
                              ? '原付款已全额退款，尚未开通团队；可重新选择套餐。'
                              : order.status === 'paid'
                                ? '付款已核验，团队开通状态需要核对，请刷新或联系实例管理员。'
                                : '原订单已关闭，尚未开通团队；可重新选择套餐。',
                      )}
                    </Notice>
                    <div className="modal-actions">
                      <Button
                        variant="secondary"
                        busy={action.busy}
                        onClick={() => void state.refetch()}
                      >
                        {t('刷新开通状态')}
                      </Button>
                      {order.status === 'draft' && (
                        <Button
                          variant="secondary"
                          busy={action.busy}
                          onClick={() =>
                            void action.run(async () => {
                              await api(
                                `/orders/${order.id}/cancel`,
                                { method: 'POST', body: '{}' },
                                pending!.workspaceId,
                              );
                              await state.refetch();
                            })
                          }
                        >
                          {t('关闭未付款草稿')}
                        </Button>
                      )}
                      {['draft', 'pending'].includes(order.status) && (
                        <Button
                          busy={action.busy}
                          onClick={() =>
                            void action.run(async () => {
                              const result = await api<{ checkoutUrl: string }>(
                                `/orders/${order.id}/checkout`,
                                { method: 'POST', body: '{}' },
                                pending!.workspaceId,
                              );
                              window.location.assign(result.checkoutUrl);
                            })
                          }
                        >
                          {t('前往原订单付款')}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {!waiting && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!plan?.available) return;
                      void action.run(async () => {
                        await post('/team-creation', {
                          name,
                          planId: plan.id,
                          expectedAmountMinor: plan.priceMinor,
                          expectedCatalogVersion: plan.catalogVersion,
                        });
                        await state.refetch();
                      });
                    }}
                  >
                    <Field label={t('团队名称')}>
                      <input
                        required
                        maxLength={120}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <Field label={t('团队会员套餐')}>
                      <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                        <option value="">{t('请选择团队会员')}</option>
                        {data.plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {money(p.priceMinor, p.currency)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {plan && (
                      <div className="panel">
                        <strong>
                          {plan.name} · {money(plan.priceMinor, plan.currency)}
                        </strong>
                        <p>
                          {t('固定期（月）')}：{plan.terms.months} · {t('团队席位')}：
                          {plan.limits.seats ?? '—'} · {t('创作额度')}：{plan.credits}
                        </p>
                        {plan.limits.brands !== undefined && (
                          <p>
                            {t(
                              plan.limits.brandQuotaScope === 'member'
                                ? '每成员品牌上限'
                                : '空间共用品牌',
                            )}
                            ：{plan.limits.brands}
                          </p>
                        )}
                        <Notice>
                          {t('一次付款，无自动续费；同档续购叠加会员时间。跨档叠加尚未支持。')}
                        </Notice>
                        <Notice>
                          {t(
                            plan.terms.creditArchiveMonths === 3
                              ? '算力到期封存3个月，同档有效续费恢复；封存逾期清零。'
                              : '此套餐采用历史无封存合同，额度随对应购买期限到期。',
                          )}
                        </Notice>
                        {plan.promotion && (
                          <Notice>
                            {plan.promotion.definition.name} ·{' '}
                            {t(
                              plan.promotion.reason ||
                                '活动内发起原支付会话；异步付款可在截止后完成。',
                            )}
                          </Notice>
                        )}
                        {!plan.available && (
                          <Notice tone="warning">{t(plan.unavailableReason)}</Notice>
                        )}
                      </div>
                    )}
                    <div className="modal-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void state.refetch()}
                      >
                        {t('刷新套餐')}
                      </Button>
                      <Button type="submit" busy={action.busy} disabled={!plan?.available}>
                        {t('保存团队开通订单')}
                      </Button>
                    </div>
                  </form>
                )}
              </>
            )}
          </>
        )
      )}
    </Modal>
  );
}
