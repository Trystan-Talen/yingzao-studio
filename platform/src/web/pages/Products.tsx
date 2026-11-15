import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Plus } from 'lucide-react';
import type { AssetDto } from '../../contracts/core';
import { ProductSchema, type ProductDto, type ProductInput } from '../../contracts/knowledge';
import {
  ApiError,
  api,
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
import { useStudio } from '../context';
import { AssetPicker, AssetVisual } from '../components/AssetPicker';
import { KnowledgeSelect, isoDateTime, localDateTime } from '../components/KnowledgeFields';
import { KnowledgeConflict } from '../components/KnowledgeConflict';
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
  PageHeader,
  Pagination,
  useAction,
} from '../components/ui';
import '../styles/knowledge.css';

function productInput(item: ProductDto): ProductInput {
  const { name, description, facts, cautions, brandId, referenceAssetIds, visibility, validUntil } =
    item;
  return { name, description, facts, cautions, brandId, referenceAssetIds, visibility, validUntil };
}

export function Products() {
  const { canEdit, session } = useStudio();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [deleted, setDeleted] = useState(false);
  const records = useApi<Page<ProductDto>>(`/products${qs({ q, page, pageSize: 24, deleted })}`);
  const [editing, setEditing] = useState<ProductDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProductDto | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [facts, setFacts] = useState('');
  const [cautions, setCautions] = useState('');
  const [brandId, setBrandId] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'workspace'>('private');
  const [validUntil, setValidUntil] = useState('');
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<unknown>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [conflict, setConflict] = useState<ProductDto | null>(null);
  const epoch = useRef(0);
  const referenceLoad = useRef<ProductDto | null>(null);
  const expirySource = useRef<string | null>(null);
  const action = useAction();
  const refresh = useRefresh();
  function close() {
    epoch.current++;
    setEditing(null);
    setConflict(null);
  }
  async function open(item: ProductDto | 'new') {
    const current = ++epoch.current;
    setEditing(item);
    setConflict(null);
    setReadError(null);
    setMissing([]);
    setName(item === 'new' ? '' : item.name);
    setDescription(item === 'new' ? '' : item.description);
    setFacts(item === 'new' ? '' : item.facts.join('\n'));
    setCautions(item === 'new' ? '' : item.cautions.join('\n'));
    setBrandId(item === 'new' ? '' : (item.brandId ?? ''));
    setVisibility(item === 'new' ? 'private' : item.visibility);
    setValidUntil(item === 'new' ? '' : localDateTime(item.validUntil));
    expirySource.current = item === 'new' ? null : item.validUntil;
    setReferences([]);
    setReading(item !== 'new');
    if (item === 'new') return;
    await loadReferences(item, current);
  }
  function currentInput(): ProductInput {
    const lines = (value: string) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    return {
      name,
      description,
      facts: lines(facts),
      cautions: lines(cautions),
      brandId: brandId || null,
      referenceAssetIds: [...references.map((asset) => asset.id), ...missing],
      visibility,
      validUntil:
        validUntil === localDateTime(expirySource.current)
          ? expirySource.current
          : isoDateTime(validUntil),
    };
  }
  function recover(latest: ProductDto, input: ProductInput) {
    setEditing(latest);
    setName(input.name);
    setDescription(input.description);
    setFacts(input.facts.join('\n'));
    setCautions(input.cautions.join('\n'));
    setBrandId(input.brandId ?? '');
    setVisibility(input.visibility);
    setValidUntil(localDateTime(input.validUntil));
    expirySource.current = input.validUntil;
    setConflict(null);
    void loadReferences({ ...latest, ...input });
  }
  async function loadReferences(item: ProductDto, current = ++epoch.current) {
    referenceLoad.current = item;
    setReading(true);
    setReadError(null);
    try {
      const assets = await Promise.all(
        item.referenceAssetIds.map(async (id) => {
          try {
            return { id, asset: await api<AssetDto>(`/assets/${id}`) };
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) return { id, asset: null };
            throw error;
          }
        }),
      );
      if (current !== epoch.current) return;
      setReferences(assets.flatMap((item) => (item.asset ? [item.asset] : [])));
      setMissing(assets.filter((item) => !item.asset).map((item) => item.id));
    } catch (error) {
      if (current === epoch.current) setReadError(error);
    } finally {
      if (current === epoch.current) setReading(false);
    }
  }
  const blocked = reading || !!readError || missing.length > 0;
  return (
    <div className="page knowledge-page">
      <PageHeader
        title={t('产品库')}
        description={t('保存产品事实、使用限制与参考图片，在创作时明确选用。')}
        action={
          canEdit && (
            <Button onClick={() => void open('new')}>
              <Plus size={17} />
              {t('创建产品')}
            </Button>
          )
        }
      />
      <div className="toolbar">
        <Button
          variant={deleted ? 'secondary' : 'primary'}
          aria-pressed={!deleted}
          onClick={() => {
            setDeleted(false);
            setPage(1);
          }}
        >
          {t('产品库')}
        </Button>
        <Button
          variant={deleted ? 'primary' : 'secondary'}
          aria-pressed={deleted}
          onClick={() => {
            setDeleted(true);
            setPage(1);
          }}
        >
          {t('回收记录')}
        </Button>
        <input
          aria-label={t('搜索产品')}
          placeholder={t('搜索产品')}
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
      </div>
      {records.isPending ? (
        <Loading />
      ) : records.error ? (
        <ErrorState error={records.error} retry={records.refetch} />
      ) : !records.data.items.length ? (
        <Empty
          icon={<Package size={30} />}
          title={t(deleted ? '暂无回收记录' : '还没有产品资料')}
          description={t('产品资料由你确认保存；系统不会从创作对话中自动推断。')}
        />
      ) : (
        <div className="knowledge-grid">
          {records.data.items.map((item) => (
            <article className="panel knowledge-card" key={item.id}>
              <div className="section-heading">
                <h2>{item.name}</h2>
                <Badge>{t(item.visibility === 'private' ? '仅自己' : '空间共享')}</Badge>
              </div>
              <p>{item.description || t('暂无描述')}</p>
              <p className="field-hint">
                {t('版本')} {item.version} · {dateTime(item.updatedAt)}
              </p>
              {item.validUntil && (
                <p className="field-hint">
                  {t('产品有效期')}：{dateTime(item.validUntil)}
                  {Date.parse(item.validUntil) <= Date.now() ? ` · ${t('已过期')}` : ''}
                </p>
              )}
              <p className="field-hint">
                {t('产品事实')}：{item.facts.length} · {t('参考图片')}：
                {item.referenceAssetIds.length}
              </p>
              <div className="card-actions">
                {deleted ? (
                  canEdit && (
                    <>
                      <Button variant="secondary" onClick={() => void open(item)}>
                        {t('编辑产品')}
                      </Button>
                      <Button
                        busy={action.busy}
                        onClick={() =>
                          void action.run(async () => {
                            await post(`/products/${item.id}/restore`, {});
                            await refresh();
                          }, '产品已恢复')
                        }
                      >
                        {t('恢复')}
                      </Button>
                    </>
                  )
                ) : (
                  <>
                    <Button variant="secondary" onClick={() => void open(item)}>
                      {t(canEdit ? '编辑产品' : '查看产品')}
                    </Button>
                    {canEdit && (
                      <Button variant="ghost" onClick={() => setDeleting(item)}>
                        {t('删除')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {records.data && (
        <Pagination page={page} total={records.data.total} pageSize={24} onPage={setPage} />
      )}
      <Modal
        open={!!editing}
        onClose={close}
        title={t(editing === 'new' ? '创建产品' : '产品资料')}
        wide
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!editing || !canEdit || blocked) return;
            const current = epoch.current;
            void action.run(async () => {
              const input = currentInput();
              try {
                if (editing === 'new') await post('/products', input);
                else
                  await patch(`/products/${editing.id}`, {
                    ...input,
                    expectedVersion: editing.version,
                  });
              } catch (error) {
                if (
                  error instanceof ApiError &&
                  error.code === 'KNOWLEDGE_VERSION_CONFLICT' &&
                  current === epoch.current
                ) {
                  const latest = ProductSchema.safeParse(error.details?.current);
                  if (latest.success && editing !== 'new' && latest.data.id === editing.id)
                    setConflict(latest.data);
                }
                throw error;
              }
              if (current === epoch.current) close();
              await refresh();
            }, '产品资料已保存');
          }}
        >
          <fieldset disabled={!canEdit || action.busy} className="knowledge-fields">
            <Field label={t('产品名称')}>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label={t('产品描述')}>
              <textarea
                maxLength={4000}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field
              label={t('产品事实（每行一条）')}
              hint={t('仅填写已确认的规格、材质和卖点，最多16条。')}
            >
              <textarea rows={4} value={facts} onChange={(event) => setFacts(event.target.value)} />
            </Field>
            <Field
              label={t('使用限制（每行一条）')}
              hint={t('例如不可宣称的功效、不可改动的外观，最多8条。')}
            >
              <textarea
                rows={3}
                value={cautions}
                onChange={(event) => setCautions(event.target.value)}
              />
            </Field>
            <div className="form-grid">
              <KnowledgeSelect
                type="brands"
                label={t('关联品牌')}
                value={brandId}
                onChange={setBrandId}
                disabled={!canEdit}
              />
              <Field label={t('可见范围')}>
                <select
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value as typeof visibility)}
                >
                  <option
                    value="private"
                    disabled={
                      !!editing && editing !== 'new' && editing.createdBy !== session?.user.id
                    }
                  >
                    {t('仅自己')}
                  </option>
                  <option value="workspace">{t('空间共享')}</option>
                </select>
                {editing && editing !== 'new' && editing.createdBy !== session?.user.id && (
                  <span className="field-hint">{t('只有产品创建者可以将共享产品设为私有')}</span>
                )}
              </Field>
              <Field
                label={t('产品有效期')}
                hint={t('包含价格、促销或阶段信息时请设置期限；到期后不能用于新规划。')}
              >
                <input
                  type="datetime-local"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                />
              </Field>
            </div>
          </fieldset>
          {conflict && editing && editing !== 'new' && (
            <KnowledgeConflict<ProductInput>
              base={productInput(editing)}
              draft={currentInput()}
              current={conflict}
              busy={action.busy || reading}
              onMerge={(merged) => recover(conflict, merged)}
              onReload={() => recover(conflict, productInput(conflict))}
            />
          )}
          {reading && <Loading />}
          {!!readError && (
            <ErrorState
              error={readError}
              retry={() => {
                if (referenceLoad.current) void loadReferences(referenceLoad.current);
              }}
            />
          )}
          {!!missing.length && (
            <Notice tone="warning">
              <p>{t('部分参考图片不可用，请恢复素材或明确移除后保存。')}</p>
              <Button
                type="button"
                variant="secondary"
                disabled={!canEdit}
                onClick={() => setMissing([])}
              >
                {t('移除不可用图片')}
              </Button>
            </Notice>
          )}
          <AssetPicker
            key={editing === 'new' ? 'new' : editing?.id}
            value={references}
            onChange={setReferences}
            kind="image"
            label={t('产品参考图片')}
            max={4}
            disabled={!canEdit || reading || !!readError || action.busy}
          />
          {references.length > 0 && (
            <div className="knowledge-thumbnails">
              {references.map((asset) => (
                <AssetVisual key={asset.id} asset={asset} />
              ))}
            </div>
          )}
          <Notice>
            {t('保存资料不会调用模型。创作时默认只带入文字，勾选后才使用产品参考图。')}
          </Notice>
          <p className="field-hint">
            <Link to="/brands">{t('管理品牌')}</Link> · {t('空间共享产品不能关联私有品牌。')}
          </p>
          <div className="modal-actions">
            <Button type="button" variant="secondary" onClick={close}>
              {t('关闭')}
            </Button>
            {canEdit && (
              <Button type="submit" busy={action.busy} disabled={blocked || !!conflict}>
                {t('保存产品')}
              </Button>
            )}
          </div>
        </form>
      </Modal>
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('删除这个产品？')}
        description={t('产品进入回收记录，历史确认方案与作品保留。')}
        busy={action.busy}
        onConfirm={() =>
          void action.run(async () => {
            if (!deleting) return;
            await remove(`/products/${deleting.id}`);
            setDeleting(null);
            await refresh();
          }, '产品已删除')
        }
      />
    </div>
  );
}
