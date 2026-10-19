import { CharacterAuthorization } from '../components/CharacterAuthorization';
import { t } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobInput } from '../lib/tasks';
import { Palette, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import type { AssetDto, BrandDto, CharacterDto } from '../../contracts/core';
import { ApiError, api, patch, post, remove, qs, useApi, useRefresh, type Page } from '../lib/api';
import { AssetPicker, AssetVisual } from '../components/AssetPicker';
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
import { useStudio } from '../context';
import { BrandQuotaSummary, type EntitlementsDto } from '../components/Entitlements';
export function Brands() {
  const { canEdit, workspace } = useStudio();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [deleted, setDeleted] = useState(false);
  const query = useApi<Page<BrandDto>>(`/brands${qs({ q, pageSize: 24, page, deleted })}`);
  const assets = useApi<Page<AssetDto>>('/assets?kind=image&pageSize=100');
  const entitlements = useApi<EntitlementsDto>('/entitlements');
  const [editing, setEditing] = useState<BrandDto | 'new' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [colors, setColors] = useState('#426856, #DDF3AD');
  const [fonts, setFonts] = useState('Inter, PingFang SC');
  const [visibility, setVisibility] = useState('workspace');
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [deleting, setDeleting] = useState<BrandDto | null>(null);
  const action = useAction();
  const refresh = useRefresh();
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<unknown>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const readVersion = useRef(0);
  const blocked = reading || !!readError || unavailable.length > 0;
  function closeEditor() {
    readVersion.current++;
    setEditing(null);
  }
  useEffect(() => {
    readVersion.current++;
    setEditing(null);
  }, [workspace?.id]);
  async function loadReferences(item: BrandDto) {
    const version = ++readVersion.current;
    setReading(true);
    setReadError(null);
    try {
      const loaded = await Promise.all(
        item.referenceAssetIds.map(async (id) => {
          try {
            return { id, asset: await api<AssetDto>(`/assets/${id}`) };
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) return { id, asset: null };
            throw error;
          }
        }),
      );
      if (readVersion.current === version) {
        setReferences(loaded.flatMap((x) => (x.asset ? [x.asset] : [])));
        setUnavailable(loaded.filter((x) => !x.asset).map((x) => x.id));
      }
    } catch (error) {
      if (readVersion.current === version) setReadError(error);
    } finally {
      if (readVersion.current === version) setReading(false);
    }
  }
  async function open(item: BrandDto | 'new') {
    setEditing(item);
    setName(item === 'new' ? '' : item.name);
    setDescription(item === 'new' ? '' : item.description);
    setColors(item === 'new' ? '#426856, #DDF3AD' : item.colors.join(', '));
    setFonts(item === 'new' ? 'Inter, PingFang SC' : item.fonts.join(', '));
    setVisibility(item === 'new' ? 'workspace' : item.visibility);
    setReferences([]);
    setUnavailable([]);
    readVersion.current++;
    setReadError(null);
    setReading(false);
    if (item !== 'new') await loadReferences(item);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (blocked || !editing || !canEdit) return;
    const editorEpoch = readVersion.current;
    await action.run(async () => {
      const payload = {
        name,
        description,
        colors: colors
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        fonts: fonts
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        visibility,
        referenceAssetIds: references.map((a) => a.id),
        coverAssetId: references[0]?.id ?? null,
      };
      if (editing === 'new') await post('/brands', payload);
      else if (editing) await patch(`/brands/${editing.id}`, payload);
      if (readVersion.current === editorEpoch) closeEditor();
      await refresh();
    }, '品牌参考已保存');
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="CONSISTENCY, BEAUTIFULLY KEPT"
        title={t('品牌')}
        description={t('把色彩、字体与参考风格放在一起，让每件作品都带着你的辨识度。')}
        action={
          canEdit && (
            <Button
              onClick={() => open('new')}
              disabled={
                entitlements.isPending ||
                !!entitlements.error ||
                entitlements.data?.brandQuota?.canCreate === false
              }
            >
              <Plus size={17} />
              {t('创建品牌')}
            </Button>
          )
        }
      />
      {entitlements.data?.brandQuota && <BrandQuotaSummary quota={entitlements.data.brandQuota} />}
      {entitlements.error && <ErrorState error={entitlements.error} retry={entitlements.refetch} />}
      <div className="toolbar">
        <Button
          type="button"
          variant={deleted ? 'primary' : 'secondary'}
          aria-pressed={deleted}
          onClick={() => {
            setDeleted(!deleted);
            setPage(1);
          }}
        >
          {t('回收记录')}
        </Button>
        <input
          className="small-search"
          placeholder={t('搜索品牌…')}
          aria-label={t('搜索品牌')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <span className="muted">{t('参考风格配置，不进行模型训练')}</span>
      </div>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : query.data?.items.length ? (
        <div className="identity-grid">
          {query.data.items.map((brand) => {
            const images =
              assets.data?.items.filter((a) => brand.referenceAssetIds.includes(a.id)) ?? [];
            return (
              <article className="identity-card" key={brand.id}>
                <button
                  className="brand-collage"
                  onClick={() => {
                    if (!deleted) void open(brand);
                  }}
                  disabled={deleted}
                  aria-label={`${t('编辑品牌')} ${brand.name}`}
                >
                  {images.length ? (
                    images.slice(0, 3).map((asset) => <AssetVisual key={asset.id} asset={asset} />)
                  ) : (
                    <div
                      className="brand-monogram"
                      style={{ background: brand.colors[0] ?? '#426856' }}
                    >
                      {brand.name.slice(0, 1)}
                    </div>
                  )}
                </button>
                <div className="identity-body">
                  <div className="section-heading">
                    <h3>{brand.name}</h3>
                    <Badge>{brand.visibility === 'private' ? t('仅自己') : t('空间共享')}</Badge>
                  </div>
                  <p>{brand.description || t('为下一次创作建立一致的视觉参考。')}</p>
                  <div className="brand-colors">
                    {brand.colors.map((color) => (
                      <span key={color} style={{ background: color }} title={color} />
                    ))}
                    <small>
                      {brand.referenceAssetIds.length}
                      {t('张参考')}
                    </small>
                  </div>
                  <div className="card-actions">
                    {deleted ? (
                      canEdit && (
                        <Button
                          type="button"
                          variant="secondary"
                          busy={action.busy}
                          onClick={() =>
                            void action.run(async () => {
                              await post(`/brands/${brand.id}/restore`, {});
                              await refresh();
                            }, '品牌参考已保存')
                          }
                        >
                          {t('恢复')}
                        </Button>
                      )
                    ) : (
                      <>
                        <Button variant="ghost" onClick={() => open(brand)}>
                          {canEdit ? t('编辑品牌') : t('查看品牌')}
                        </Button>
                        {canEdit && (
                          <Button variant="ghost" onClick={() => setDeleting(brand)}>
                            <Trash2 size={15} />
                            {t('删除')}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={<Palette size={34} />}
          title={deleted ? t('暂无回收记录') : t('让品牌风格，始终如一')}
          description={t('保存品牌色、字体与参考图片，创作时一键引用。')}
          action={
            canEdit &&
            !deleted && (
              <Button
                onClick={() => open('new')}
                disabled={
                  entitlements.isPending ||
                  !!entitlements.error ||
                  entitlements.data?.brandQuota?.canCreate === false
                }
              >
                <Plus size={16} />
                {t('创建第一个品牌')}
              </Button>
            )
          }
        />
      )}
      {query.data && (
        <Pagination
          page={page}
          total={query.data.total}
          pageSize={query.data.pageSize}
          onPage={setPage}
        />
      )}
      <Modal
        open={!!editing}
        onClose={closeEditor}
        title={editing === 'new' ? t('创建品牌') : t('品牌参考')}
        wide
      >
        {reading && <Loading />}
        {!!readError && (
          <ErrorState
            error={readError}
            retry={() => {
              if (editing && editing !== 'new') void loadReferences(editing);
            }}
          />
        )}
        {unavailable.length > 0 && (
          <Notice tone="warning">
            {t('部分引用素材已删除。请明确移除失效引用后再保存。')}
            <Button type="button" variant="secondary" onClick={() => setUnavailable([])}>
              {t('移除失效引用')} · {unavailable.length}
            </Button>
          </Notice>
        )}
        <form onSubmit={save} inert={blocked}>
          <div className="form-grid">
            <Field label={t('品牌名称')}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                disabled={!canEdit}
              />
            </Field>
            <Field label={t('可见范围')}>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                disabled={!canEdit}
              >
                <option value="workspace">{t('工作空间成员')}</option>
                <option value="private">{t('仅自己')}</option>
              </select>
            </Field>
          </div>
          <Field label={t('品牌描述')}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
              rows={3}
              disabled={!canEdit}
            />
          </Field>
          <div className="form-grid">
            <Field label={t('品牌颜色')} hint={t('使用HEX色值，以逗号分隔')}>
              <input
                value={colors}
                onChange={(e) => setColors(e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label={t('偏好字体')} hint={t('字体名称，以逗号分隔')}>
              <input value={fonts} onChange={(e) => setFonts(e.target.value)} disabled={!canEdit} />
            </Field>
          </div>
          <AssetPicker
            key={editing === 'new' ? 'new' : editing?.id}
            value={references}
            onChange={setReferences}
            label={t('品牌参考图 · 第一张作为封面')}
            max={20}
          />
          <Notice>
            {t('参考图用于为创作提供视觉风格。保存品牌不会训练模型，也不会调用付费生成。')}
          </Notice>
          <div className="modal-actions">
            <Button variant="secondary" type="button" onClick={closeEditor}>
              {t('关闭')}
            </Button>
            {canEdit && (
              <Button type="submit" busy={action.busy} disabled={blocked}>
                {t('保存品牌')}
              </Button>
            )}
          </div>
        </form>
      </Modal>
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('删除这个品牌？')}
        description={t('品牌配置会保留在回收记录中，已经生成的作品不会删除。')}
        onConfirm={() =>
          void action.run(async () => {
            if (!deleting) return;
            await remove(`/brands/${deleting.id}`);
            setDeleting(null);
            await refresh();
          }, '品牌已删除')
        }
        busy={action.busy}
      />
    </div>
  );
}
const verificationLabels: Record<string, string> = {
  unverified: '未认证',
  pending: '审核中',
  verified: '已认证',
  rejected: '未通过',
  expired: '已过期',
};
export function Characters() {
  const navigate = useNavigate();
  const { canEdit, workspace } = useStudio();
  const [page, setPage] = useState(1);
  const query = useApi<Page<CharacterDto>>(`/characters?pageSize=24&page=${page}`);
  const assets = useApi<Page<AssetDto>>('/assets?pageSize=100');
  const [editing, setEditing] = useState<CharacterDto | 'new' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [deleting, setDeleting] = useState<CharacterDto | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<unknown>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const readVersion = useRef(0);
  const blocked = reading || !!readError;
  useEffect(() => {
    readVersion.current++;
    setEditing(null);
  }, [workspace?.id]);
  function closeEditor() {
    readVersion.current++;
    setEditing(null);
  }

  const refresh = useRefresh();
  const action = useAction();
  async function open(item: CharacterDto | 'new') {
    const version = ++readVersion.current;
    setEditing(item);
    setName(item === 'new' ? '' : item.name);
    setDescription(item === 'new' ? '' : item.description);
    setReferences([]);
    setUnavailable([]);
    setReadError(null);
    setReading(item !== 'new');
    if (item === 'new') return;
    try {
      const loaded = await Promise.all(
        item.referenceAssetIds.map(async (id) => {
          try {
            return { id, asset: await api<AssetDto>(`/assets/${id}`) };
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) return { id, asset: null };
            throw error;
          }
        }),
      );
      if (readVersion.current !== version) return;
      setReferences(loaded.flatMap(({ asset }) => (asset ? [asset] : [])));
      setUnavailable(loaded.filter(({ asset }) => !asset).map(({ id }) => id));
    } catch (error) {
      if (readVersion.current === version) setReadError(error);
    } finally {
      if (readVersion.current === version) setReading(false);
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="FAMILIAR FACES, NEW STORIES"
        title={t('人物')}
        description={t('整理人物参考素材，让不同场景中的角色表达保持连贯。')}
        action={
          canEdit && (
            <Button onClick={() => open('new')}>
              <Plus size={17} />
              {t('创建人物')}
            </Button>
          )
        }
      />
      <Notice>
        {t(
          '人物参考与身份认证分别管理。上传素材不会自动获得认证；需要认证的能力会检查真实的服务状态。',
        )}
      </Notice>
      <Notice>
        {t(
          '人物库支持分别保存图片与视频。当前普通人物创作只接受图片参考；含视频的人物不会自动转换或丢弃视频。',
        )}
      </Notice>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : query.data?.items.length ? (
        <div className="identity-grid">
          {query.data.items.map((character) => {
            const cover = assets.data?.items.find((a) => a.id === character.coverAssetId);
            return (
              <article className="identity-card" key={character.id}>
                <button
                  className="character-cover"
                  aria-label={`查看${character.name}`}
                  onClick={() => open(character)}
                >
                  {cover ? <AssetVisual asset={cover} /> : <UserRound size={56} strokeWidth={1} />}
                </button>
                <div className="identity-body">
                  <div className="section-heading">
                    <h3>{character.name}</h3>
                    <Badge
                      tone={character.verification.status === 'verified' ? 'green' : 'neutral'}
                    >
                      {t(
                        verificationLabels[character.verification.status] ??
                          character.verification.status,
                      )}
                    </Badge>
                  </div>
                  <p>
                    {character.description ||
                      t('{value} 份参考素材').replace(
                        '{value}',
                        String(character.referenceAssetIds.length),
                      )}
                  </p>
                  <div className="card-actions">
                    <Button variant="ghost" onClick={() => open(character)}>
                      {canEdit ? t('编辑人物') : t('查看人物')}
                    </Button>
                    {canEdit && (
                      <Button
                        variant="secondary"
                        busy={action.busy}
                        disabled={character.authorization.status !== 'active'}
                        onClick={() =>
                          void action.run(async () => {
                            const media = await Promise.all(
                              character.referenceAssetIds.map((id) =>
                                api<AssetDto>(`/assets/${id}`),
                              ),
                            );
                            if (media.some((asset) => asset.kind !== 'image'))
                              throw new Error(
                                t(
                                  '人物视频参考尚不能用于当前创作；资料和草稿已保留，请选择仅含图片的人物参考。',
                                ),
                              );
                            const draft = jobInput({
                              operation: 'image.generate',
                              providerId: 'openai',
                              characterId: character.id,
                              characterRevision: character.authorization.referenceRevision,
                              prompt: character.description || character.name,
                              assetIds: character.referenceAssetIds,
                              referenceAssetIds: [],
                              options: {},
                            });
                            const project = await post<{ id: string }>('/projects', {
                              name: character.name,
                              kind: 'image',
                              description: character.description,
                            });
                            await post(`/projects/${project.id}/messages`, {
                              role: 'user',
                              content: character.description || character.name,
                              metadata: { draft },
                            });
                            navigate(`/workbench/${project.id}`);
                          })
                        }
                      >
                        {t('以此形象创作')}
                      </Button>
                    )}
                    {character.authorization.status !== 'active' && (
                      <small className="muted">
                        {t('请先在人物资料中登记有效的参考使用授权。')}
                      </small>
                    )}
                    {canEdit && (
                      <Button variant="ghost" onClick={() => setDeleting(character)}>
                        <Trash2 size={15} />
                        {t('删除')}
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={<UserRound size={34} />}
          title={t('故事里的主角，从这里开始')}
          description={t('添加人物名称、参考图片或视频，建立自己的角色素材库。')}
          action={
            canEdit && (
              <Button onClick={() => open('new')}>
                <Plus size={16} />
                {t('创建人物')}
              </Button>
            )
          }
        />
      )}
      {query.data && (
        <Pagination
          page={page}
          total={query.data.total}
          pageSize={query.data.pageSize}
          onPage={setPage}
        />
      )}
      <Modal
        open={!!editing}
        onClose={closeEditor}
        title={editing === 'new' ? t('创建人物') : t('人物资料')}
      >
        {reading && <Loading label={t('正在读取人物素材，完成前不能保存。')} />}
        {!!readError && (
          <ErrorState error={readError} retry={() => editing && void open(editing)} />
        )}
        {unavailable.length > 0 && (
          <Notice tone="warning">
            {t(
              '部分人物素材已删除或无法访问。原引用仍保留；请恢复素材，或明确移除失效引用后保存。',
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={!canEdit || blocked}
              onClick={() => setUnavailable([])}
            >
              {t('移除失效引用')} · {unavailable.length}
            </Button>
          </Notice>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (blocked || unavailable.length || !canEdit) return;
            void action.run(async () => {
              const editorVersion = readVersion.current;
              const payload = {
                name,
                description,
                referenceAssetIds: references.map((a) => a.id),
                coverAssetId: references[0]?.id ?? null,
              };
              if (editing === 'new') await post('/characters', payload);
              else if (editing) await patch(`/characters/${editing.id}`, payload);
              if (readVersion.current === editorVersion) closeEditor();
              await refresh();
            }, '人物资料已保存');
          }}
        >
          <Field label={t('人物名称')}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              disabled={!canEdit || blocked}
            />
          </Field>
          <Field label={t('角色说明')}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={!canEdit || blocked}
            />
          </Field>
          <AssetPicker
            key={`${editing === 'new' ? 'new' : editing?.id}:images`}
            label={t('参考图片')}
            kind="image"
            value={references.filter((a) => a.kind === 'image')}
            max={Math.max(
              0,
              20 - references.filter((a) => a.kind !== 'image').length - unavailable.length,
            )}
            disabled={!canEdit || blocked}
            onChange={(images) =>
              setReferences((current) => [...images, ...current.filter((a) => a.kind !== 'image')])
            }
          />
          <AssetPicker
            key={`${editing === 'new' ? 'new' : editing?.id}:videos`}
            label={t('人物参考视频')}
            kind="video"
            value={references.filter((a) => a.kind === 'video')}
            max={Math.max(
              0,
              20 - references.filter((a) => a.kind !== 'video').length - unavailable.length,
            )}
            disabled={!canEdit || blocked}
            onChange={(videos) =>
              setReferences((current) => [...current.filter((a) => a.kind !== 'video'), ...videos])
            }
          />
          {references
            .filter((a) => a.kind === 'video')
            .map((asset) => (
              <figure key={asset.id}>
                <div className="asset-detail-preview">
                  <video
                    aria-label={`${t('人物参考视频')}: ${asset.name}`}
                    src={asset.originalUrl}
                    controls
                    preload="metadata"
                    playsInline
                  />
                </div>
                <figcaption>{asset.name}</figcaption>
              </figure>
            ))}
          {editing && editing !== 'new' && (
            <CharacterAuthorization key={editing.id} characterId={editing.id} />
          )}
          {editing && editing !== 'new' && (
            <Notice>
              <ShieldCheck size={15} />
              {t('认证状态：')}
              {t(verificationLabels[editing.verification.status] ?? editing.verification.status)}
              {t('。身份核验服务未连接时，状态不会被人工标为“已认证”。')}
            </Notice>
          )}
          <div className="modal-actions">
            <Button variant="secondary" type="button" onClick={closeEditor}>
              {t('关闭')}
            </Button>
            {canEdit && (
              <Button type="submit" busy={action.busy} disabled={blocked || unavailable.length > 0}>
                {t('保存人物')}
              </Button>
            )}
          </div>
        </form>
      </Modal>
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('删除人物资料？')}
        description={t('人物资料将隐藏，已保存的参考素材与作品保留。')}
        busy={action.busy}
        onConfirm={() =>
          void action.run(async () => {
            if (!deleting) return;
            await remove(`/characters/${deleting.id}`);
            setDeleting(null);
            await refresh();
          }, '人物资料已删除')
        }
      />
    </div>
  );
}
