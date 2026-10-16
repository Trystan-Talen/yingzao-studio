import type { Actor } from '../../contracts/core';
import {
  notificationCategorySchema,
  notificationQuerySchema,
  type NotificationListQuery,
  type NotificationPage,
  type NotificationUnread,
} from '../../contracts/notifications';
import { CoreContext, nullable, str } from './shared';

// Only the existing appeal decision event has an evidenced review meaning.
// Historical text or an orphaned prefix must not invent a review notification.
const CATEGORY_SQL = `CASE WHEN n.event_key LIKE 'appeal:%' AND EXISTS (
  SELECT 1 FROM support_resolutions r
  JOIN support_tickets t ON t.id=r.ticket_id
  WHERE r.ticket_id=substr(n.event_key,8)
    AND r.workspace_id=n.workspace_id
    AND t.workspace_id=n.workspace_id
    AND t.created_by=n.user_id
    AND t.category='appeal'
) THEN 'review' ELSE 'system' END`;

export class NotificationService {
  constructor(private c: CoreContext) {}

  private unread(actor: Actor, wid: string): NotificationUnread {
    const counts = this.c.get<{ total: number; review: number }>(
      `SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN ${CATEGORY_SQL}='review' THEN 1 ELSE 0 END),0) AS review
       FROM notifications n WHERE n.workspace_id=? AND n.user_id=? AND n.read_at IS NULL`,
      wid,
      actor.userId,
    )!;
    return { system: counts.total - counts.review, review: counts.review, total: counts.total };
  }

  list(actor: Actor, wid: string, raw: NotificationListQuery = {}): NotificationPage {
    // A single deferred read transaction gives page totals, rows and unread counts one snapshot.
    return this.c.db.sqlite
      .transaction(() => {
        this.c.requireAccess(actor, wid, 'read');
        const query = notificationQuerySchema.parse(raw);
        const conditions = ['n.workspace_id=?', 'n.user_id=?'];
        const parameters: unknown[] = [wid, actor.userId];
        if (query.category) {
          conditions.push(`${CATEGORY_SQL}=?`);
          parameters.push(query.category);
        }
        const page = this.c.page(
          `SELECT n.*,${CATEGORY_SQL} AS category FROM notifications n
         WHERE ${conditions.join(' AND ')} ORDER BY n.created_at DESC,n.id`,
          parameters,
          query,
          (row) => ({
            id: str(row, 'id'),
            title: str(row, 'title'),
            message: str(row, 'message'),
            category: notificationCategorySchema.parse(row.category),
            readAt: nullable(row, 'read_at'),
            createdAt: str(row, 'created_at'),
          }),
        );
        return { ...page, unread: this.unread(actor, wid) };
      })
      .deferred();
  }

  summary(actor: Actor, wid: string): NotificationUnread {
    return this.c.db.sqlite
      .transaction(() => {
        this.c.requireAccess(actor, wid, 'read');
        return this.unread(actor, wid);
      })
      .deferred();
  }
}
