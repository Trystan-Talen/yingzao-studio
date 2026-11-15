import type { Actor } from '../../contracts/core';
import {
  localTestGrantInputSchema,
  MAX_LOCAL_TEST_GRANT,
  type LocalTestGrantAvailabilityDto,
  type LocalTestGrantResultDto,
} from '../../contracts/local-test-credits';
import { isInstallationOwner } from '../core/installation-owner';
import { AppError } from '../errors';
import type { TaskServices } from './service';

const loopbackHosts = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const localPeers = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/** Developer-installation budget only: no orders, payments, or provider account requests. */
export function createLocalTestCreditService(s: TaskServices) {
  function availability(actor: Actor, wid: string, peer: string): LocalTestGrantAvailabilityDto {
    const membership = s.core.requireAccess(actor, wid, 'read');
    let localOrigin = false;
    try {
      localOrigin = loopbackHosts.includes(new URL(s.config.publicOrigin).hostname);
    } catch {
      /* Invalid configuration is never an authorization grant. */
    }
    const reason =
      s.config.isProduction ||
      !loopbackHosts.includes(s.config.host) ||
      !localOrigin ||
      !localPeers.includes(peer)
        ? '此功能仅适用于本机开发部署。'
        : actor.authType !== 'session'
          ? '增加本地测试额度需要网页登录。'
          : !isInstallationOwner(s.db, actor.userId)
            ? '仅此安装的管理员可增加本地测试额度。'
            : !['owner', 'admin'].includes(membership.role)
              ? '请切换到你有管理权限的工作空间。'
              : null;
    return { available: !reason, maxCredits: MAX_LOCAL_TEST_GRANT, reason };
  }
  function grant(actor: Actor, wid: string, peer: string, raw: unknown): LocalTestGrantResultDto {
    const input = localTestGrantInputSchema.parse(raw);
    return s.transaction(() => {
      const permission = availability(actor, wid, peer);
      if (!permission.available)
        throw new AppError(403, 'LOCAL_TEST_GRANT_FORBIDDEN', permission.reason!);
      s.core.requireAccess(actor, wid, 'manage');
      const eventKey = `local-test-grant:${actor.userId}:${input.requestId}`;
      const prior = s.db.sqlite
        .prepare('SELECT 1 FROM credit_lot_operations WHERE event_key=?')
        .get(eventKey);
      const result = s.credits.forChannel('web').grant({
        workspaceId: wid,
        userId: actor.userId,
        eventKey,
        amount: input.amount,
        source: 'manual',
        sourceId: input.requestId,
        description: '本地测试额度（内部预算，无现金价值）',
      });
      if (!prior)
        s.core.context.audit(actor, wid, 'credits.local-test-grant', 'credit-lot', result.lotId, {
          amount: input.amount,
          requestId: input.requestId,
          billingChannel: 'web',
          purpose: 'local-testing',
        });
      return {
        granted: input.amount,
        alreadyApplied: Boolean(prior),
        credits: s.balance(actor, wid, 'web'),
      };
    });
  }
  return { availability, grant };
}
