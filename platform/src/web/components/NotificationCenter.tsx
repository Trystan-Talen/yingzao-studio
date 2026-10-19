import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import type {
  NotificationCategory,
  NotificationPage,
  NotificationUnread,
} from '../../contracts/notifications';
import { useStudio } from '../context';
import { api, post, useApi, useRefresh } from '../lib/api';
import { t } from '../lib/i18n';
import {
  Button,
  Drawer,
  Empty,
  ErrorState,
  IconButton,
  Loading,
  Pagination,
  Segments,
  useAction,
} from './ui';

export function NotificationCenter() {
  const { workspace } = useStudio();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<NotificationCategory>('system');
  const summary = useApi<NotificationUnread>('/notifications/unread', !!workspace, 30000);
  const path = `/notifications?pageSize=24&page=${page}&category=${category}`;
  const notices = useQuery({
    queryKey: ['api', workspace?.id ?? null, path],
    queryFn: ({ signal }) => api<NotificationPage>(path, { signal }, workspace?.id ?? null),
    enabled: open && !!workspace,
    retry: false,
  });
  const refresh = useRefresh(),
    action = useAction();
  useEffect(() => {
    setOpen(false);
    setPage(1);
    setCategory('system');
  }, [workspace?.id]);
  const unread = notices.data?.unread ?? summary.data;
  const label = (kind: NotificationCategory) =>
    `${t(kind === 'system' ? '系统消息' : '审核通知')} · ${unread?.[kind] ?? '—'}`;
  return (
    <>
      <IconButton label={t('通知')} className="notification-trigger" onClick={() => setOpen(true)}>
        <Bell size={19} />
        {!!unread?.total && (
          <span className="notification-count" aria-hidden="true">
            {unread.total > 99 ? '99+' : unread.total}
          </span>
        )}
      </IconButton>
      <Drawer open={open} onClose={() => setOpen(false)} title={t('通知')}>
        <Segments
          value={category}
          options={(['system', 'review'] as const).map((value) => ({ value, label: label(value) }))}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
        />
        <p className="muted small" role="status">
          {unread
            ? t('当前空间未读 {value} 条').replace('{value}', String(unread.total))
            : summary.error
              ? t('未读数量暂不可用，请重试。')
              : t('正在加载未读数量…')}
        </p>
        {notices.isPending ? (
          <Loading label={t('正在加载…')} />
        ) : notices.error ? (
          <ErrorState error={notices.error} retry={() => notices.refetch()} />
        ) : notices.data?.items.length ? (
          <>
            {notices.data.items.map((notice) => (
              <article className="notification" key={notice.id}>
                <strong>{notice.title}</strong>
                <p>{notice.message}</p>
                {!notice.readAt && (
                  <Button
                    variant="ghost"
                    busy={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await post(`/notifications/${notice.id}/read`);
                        await refresh();
                      })
                    }
                  >
                    {t('标为已读')}
                  </Button>
                )}
              </article>
            ))}
            <Pagination
              page={page}
              total={notices.data.total}
              pageSize={notices.data.pageSize}
              onPage={setPage}
            />
          </>
        ) : (
          <Empty
            title={t('暂时没有新消息')}
            description={t('任务结果与工作空间动态会在这里通知你。')}
          />
        )}
      </Drawer>
    </>
  );
}
