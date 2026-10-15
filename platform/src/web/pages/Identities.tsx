import { CharacterAuthorization } from '../components/CharacterAuthorization';
import { t } from '../lib/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobInput } from '../lib/tasks';
import { Palette, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import type { AssetDto, BrandDto, CharacterDto } from '../../contracts/core';
import { api, patch, post, remove, qs, useApi, useRefresh, type Page } from '../lib/api';
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
export function Brands() {
  const { canEdit } = useStudio();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const query = useApi<Page<BrandDto>>(`/brands${qs({ q, pageSize: 24, page })}`);
  const assets = useApi<Page<AssetDto>>('/assets?kind=image&pageSize=100');
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
  async function open(item: BrandDto | 'new') {
    setEditing(item);
    setName(item === 'new' ? '' : item.name);
    setDescription(item === 'new' ? '' : item.description);
    setColors(item === 'new' ? '#426856, #DDF3AD' : item.colors.join(', '));
    setFonts(item === 'new' ? 'Inter, PingFang SC' : item.fonts.join(', '));
    setVisibility(item === 'new' ? 'workspace' : item.visibility);
    setReferences([]);
    if (item !== 'new')
      await action.run(async () => {
        try {
          setReferences(
            await Promise.all(item.referenceAssetIds.map((id) => api<AssetDto>(`/assets/${id}`))),
          );
        } catch (error) {
          setEditing(null);
          throw error;
        }
      });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
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
      setEditing(null);
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
            <Button onClick={() => open('new')}>
              <Plus size={17} />
              {t('创建品牌')}
            </Button>
          )
        }
      />
      <div className="toolbar">
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
                  onClick={() => open(brand)}
                  aria-label={`编辑${brand.name}`}
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
                  <p>{brand.description || '为下一次创作建立一致的视觉参考。'}</p>
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
                    <Button variant="ghost" onClick={() => open(brand)}>
                      {canEdit ? t('编辑品牌') : t('查看品牌')}
                    </Button>
                    {canEdit && (
                      <Button variant="ghost" onClick={() => setDeleting(brand)}>
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
          icon={<Palette size={34} />}
          title={t('让品牌风格，始终如一')}
          description={t('保存品牌色、字体与参考图片，创作时一键引用。')}
          action={
            canEdit && (
              <Button onClick={() => open('new')}>
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
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('创建品牌') : t('品牌参考')}
        wide
      >
        <form onSubmit={save}>
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
            value={references}
            onChange={setReferences}
            label={t('品牌参考图 · 第一张作为封面')}
            max={20}
          />
          <Notice>
            {t('参考图用于为创作提供视觉风格。保存品牌不会训练模型，也不会调用付费生成。')}
          </Notice>
          <div className="modal-actions">
            <Button variant="secondary" type="button" onClick={() => setEditing(null)}>
              {t('关闭')}
            </Button>
            {canEdit && (
              <Button type="submit" busy={action.busy}>
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
  const { canEdit } = useStudio();
  const [page, setPage] = useState(1);
  const query = useApi<Page<CharacterDto>>(`/characters?pageSize=24&page=${page}`);
  const assets = useApi<Page<AssetDto>>('/assets?kind=image&pageSize=100');
  const [editing, setEditing] = useState<CharacterDto | 'new' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [deleting, setDeleting] = useState<CharacterDto | null>(null);
  const refresh = useRefresh();
  const action = useAction();
  async function open(item: CharacterDto | 'new') {
    setEditing(item);
    setName(item === 'new' ? '' : item.name);
    setDescription(item === 'new' ? '' : item.description);
    setReferences([]);
    if (item !== 'new')
      await action.run(async () => {
        try {
          setReferences(
            await Promise.all(item.referenceAssetIds.map((id) => api<AssetDto>(`/assets/${id}`))),
          );
        } catch (error) {
          setEditing(null);
          throw error;
        }
      });
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
                    {character.description || `${character.referenceAssetIds.length} 份参考素材`}
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
          description={t('添加人物名称与参考图，建立自己的角色素材库。')}
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
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('创建人物') : t('人物资料')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const payload = {
                name,
                description,
                referenceAssetIds: references.map((a) => a.id),
                coverAssetId: references[0]?.id ?? null,
              };
              if (editing === 'new') await post('/characters', payload);
              else if (editing) await patch(`/characters/${editing.id}`, payload);
              setEditing(null);
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
              disabled={!canEdit}
            />
          </Field>
          <Field label={t('角色说明')}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={!canEdit}
            />
          </Field>
          <AssetPicker label={t('参考图片')} value={references} onChange={setReferences} />
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
            <Button variant="secondary" type="button" onClick={() => setEditing(null)}>
              {t('关闭')}
            </Button>
            {canEdit && (
              <Button type="submit" busy={action.busy}>
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
