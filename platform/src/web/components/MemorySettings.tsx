import { useRef, useState } from 'react';
import { MemorySchema, type MemoryDto, type MemoryInput } from '../../contracts/knowledge';
import {
  ApiError,
  dateTime,
  patch,
  post,
  qs,
  remove,
  useApi,
  useRefresh,
  type Page,
} from '../lib/api';
import { t } from '../lib/i18n';
import { isoDateTime, localDateTime } from './KnowledgeFields';
import { KnowledgeConflict } from './KnowledgeConflict';
import {
  Badge,
  Button,
  Confirm,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  Pagination,
  useAction,
} from './ui';
import '../styles/knowledge.css';

const kindLabels = { profile: '长期背景', preference: '创作偏好', temporary: '临时要求' } as const;
const mediaLabels = { all: '图片与视频', image: '图片', video: '视频' } as const;
function memoryInput(item: MemoryDto): MemoryInput {
  return {
    topic: item.topic,
    content: item.content,
    kind: item.kind,
    mediaType: item.mediaType,
    expiresAt: item.expiresAt,
    halfLifeDays: item.halfLifeDays,
    status: item.status,
  };
}
export function MemoryEditor({
  item,
  initialContent = '',
  onClose,
}: {
  item?: MemoryDto;
  initialContent?: string;
  onClose: () => void;
}) {
  const [topic, setTopic] = useState(item?.topic ?? '');
  const [content, setContent] = useState(item?.content ?? initialContent);
  const [kind, setKind] = useState<MemoryInput['kind']>(item?.kind ?? 'temporary');
  const [mediaType, setMediaType] = useState<MemoryInput['mediaType']>(item?.mediaType ?? 'all');
  const [expiresAt, setExpiresAt] = useState(localDateTime(item?.expiresAt));
  const [halfLifeDays, setHalfLifeDays] = useState(item?.halfLifeDays ?? 90);
  const [status, setStatus] = useState<MemoryInput['status']>(item?.status ?? 'active');
  const baseline = useRef(item);
  const expirySource = useRef(item?.expiresAt ?? null);
  const [conflict, setConflict] = useState<MemoryDto | null>(null);
  const action = useAction();
  const refresh = useRefresh();
  const active = useRef(true);
  function close() {
    active.current = false;
    onClose();
  }
  function currentInput(): MemoryInput {
    return {
      topic,
      content,
      kind,
      mediaType,
      expiresAt:
        expiresAt === localDateTime(expirySource.current)
          ? expirySource.current
          : isoDateTime(expiresAt),
      halfLifeDays: kind === 'preference' ? halfLifeDays : null,
      status,
    };
  }
  function recover(latest: MemoryDto, input: MemoryInput) {
    baseline.current = latest;
    expirySource.current = input.expiresAt;
    setTopic(input.topic);
    setContent(input.content);
    setKind(input.kind);
    setMediaType(input.mediaType);
    setExpiresAt(localDateTime(input.expiresAt));
    setHalfLifeDays(input.halfLifeDays ?? 90);
    setStatus(input.status);
    setConflict(null);
  }
  return (
    <Modal open onClose={close} title={t(item ? '编辑记忆' : '添加记忆')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const input = currentInput();
            try {
              if (baseline.current)
                await patch(`/memories/${baseline.current.id}`, {
                  ...input,
                  expectedVersion: baseline.current.version,
                });
              else await post('/memories', input);
            } catch (error) {
              if (
                error instanceof ApiError &&
                error.code === 'KNOWLEDGE_VERSION_CONFLICT' &&
                active.current
              ) {
                const latest = MemorySchema.safeParse(error.details?.current);
                if (latest.success && latest.data.id === baseline.current?.id)
                  setConflict(latest.data);
              }
              throw error;
            }
            if (active.current) close();
            await refresh();
          }, '创作记忆已保存');
        }}
      >
        <Notice>{t('只保存你明确确认的信息；本次需求不会自动变成长期记忆。')}</Notice>
        <fieldset className="knowledge-fields" disabled={action.busy}>
          <Field
            label={t('记忆主题')}
            hint={t('同一适用范围的相同主题请编辑原记忆，避免重复与矛盾。')}
          >
            <input
              required
              maxLength={80}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            />
          </Field>
          <Field label={t('记忆内容')} hint={t('最多2000字；请精简为需要跨次复用的内容。')}>
            <textarea
              required
              rows={5}
              maxLength={2000}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label={t('记忆类型')}>
              <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('适用创作')}>
              <select
                value={mediaType}
                onChange={(event) => setMediaType(event.target.value as typeof mediaType)}
              >
                {Object.entries(mediaLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('到期时间')} hint={t('临时要求必须设置期限；到期后不再带入新规划。')}>
              <input
                type="datetime-local"
                required={kind === 'temporary'}
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </Field>
            {kind === 'preference' && (
              <Field
                label={t('半衰期（天）')}
                hint={t('偏好权重随时间降低，低于四分之一后不再自动采用；重新确认可恢复权重。')}
              >
                <input
                  type="number"
                  required
                  min={1}
                  max={3650}
                  value={halfLifeDays}
                  onChange={(event) => setHalfLifeDays(Number(event.target.value))}
                />
              </Field>
            )}
            <Field label={t('记忆状态')}>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as typeof status)}
              >
                <option value="active">{t('启用')}</option>
                <option value="paused">{t('停用')}</option>
              </select>
            </Field>
          </div>
          {kind === 'profile' && (
            <p className="field-hint">{t('职业等长期背景不随时间衰减；发生变化时请编辑替换。')}</p>
          )}
        </fieldset>
        {conflict && baseline.current && (
          <KnowledgeConflict<MemoryInput>
            base={memoryInput(baseline.current)}
            draft={currentInput()}
            current={conflict}
            busy={action.busy}
            onMerge={(merged) => recover(conflict, merged)}
            onReload={() => recover(conflict, memoryInput(conflict))}
          />
        )}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={close}>
            {t('关闭')}
          </Button>
          <Button type="submit" busy={action.busy} disabled={content.length > 2000 || !!conflict}>
            {t('保存记忆')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function MemorySettings() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const records = useApi<Page<MemoryDto>>(
    `/memories${qs({ q, page, pageSize: 24 })}`,
    true,
    60_000,
  );
  const [editing, setEditing] = useState<MemoryDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MemoryDto | null>(null);
  const action = useAction();
  const refresh = useRefresh();
  return (
    <section className="section-spaced knowledge-page" aria-label={t('创作记忆')}>
      <div className="section-heading">
        <h2>{t('创作记忆')}</h2>
        {<Button onClick={() => setEditing('new')}>{t('添加记忆')}</Button>}
      </div>
      <Notice>
        {t(
          '记忆管理仅你在当前空间可见。被采用的信息可能出现在协作成员可见的方案和作品中；每次创作都可关闭记忆。',
        )}
      </Notice>
      <p className="field-hint">
        {t('停用、过期或衰减过低的记忆不带入新规划。编辑或删除不会改写历史确认方案。')}
      </p>
      <input
        aria-label={t('搜索记忆')}
        placeholder={t('搜索记忆')}
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setPage(1);
        }}
      />
      {records.isPending ? (
        <Loading />
      ) : records.error ? (
        <ErrorState error={records.error} retry={records.refetch} />
      ) : !records.data.items.length ? (
        <Empty
          title={t('还没有创作记忆')}
          description={t('保存职业背景、常用风格或有期限的要求，下一次创作按需复用。')}
        />
      ) : (
        <div className="knowledge-grid">
          {records.data.items.map((item) => (
            <article className="panel knowledge-card" key={item.id}>
              <div className="section-heading">
                <h3>{item.topic}</h3>
                <Badge tone={item.eligible ? 'green' : 'neutral'}>
                  {t(
                    item.eligible
                      ? '可用于新规划'
                      : item.status === 'paused'
                        ? '已停用'
                        : item.expiresAt && Date.parse(item.expiresAt) <= Date.now()
                          ? '已过期'
                          : '待重新确认',
                  )}
                </Badge>
              </div>
              <p>{item.content}</p>
              <p className="field-hint">
                {t(kindLabels[item.kind])} · {t(mediaLabels[item.mediaType])} · {t('版本')}{' '}
                {item.version}
              </p>
              <p className="field-hint">
                {t('最近确认')}：{dateTime(item.confirmedAt)}
                {item.kind === 'preference'
                  ? ` · ${t('当前权重')} ${Math.round(item.effectiveWeight * 100)}%`
                  : ''}
              </p>
              {item.expiresAt && (
                <p className="field-hint">
                  {t('到期时间')}：{dateTime(item.expiresAt)}
                </p>
              )}
              {
                <div className="card-actions">
                  <Button variant="secondary" onClick={() => setEditing(item)}>
                    {t('编辑记忆')}
                  </Button>
                  <Button
                    variant="ghost"
                    busy={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await patch(`/memories/${item.id}`, {
                          ...memoryInput(item),
                          expectedVersion: item.version,
                          status: item.status === 'active' ? 'paused' : 'active',
                        });
                        await refresh();
                      }, '创作记忆已保存')
                    }
                  >
                    {t(item.status === 'active' ? '停用' : '启用')}
                  </Button>
                  <Button
                    variant="ghost"
                    busy={action.busy}
                    disabled={!!item.expiresAt && Date.parse(item.expiresAt) <= Date.now()}
                    onClick={() =>
                      void action.run(async () => {
                        await patch(`/memories/${item.id}`, {
                          ...memoryInput(item),
                          expectedVersion: item.version,
                        });
                        await refresh();
                      }, '记忆已重新确认')
                    }
                  >
                    {t('重新确认')}
                  </Button>
                  <Button variant="ghost" onClick={() => setDeleting(item)}>
                    {t('删除')}
                  </Button>
                </div>
              }
            </article>
          ))}
        </div>
      )}
      {records.data && (
        <Pagination page={page} total={records.data.total} pageSize={24} onPage={setPage} />
      )}
      {editing && (
        <MemoryEditor
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`}
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('删除这条记忆？')}
        description={t('删除后不再用于新规划；已经确认的历史方案仍保留当时快照。')}
        busy={action.busy}
        onConfirm={() =>
          void action.run(async () => {
            if (!deleting) return;
            await remove(`/memories/${deleting.id}`);
            setDeleting(null);
            await refresh();
          }, '记忆已删除')
        }
      />
    </section>
  );
}
