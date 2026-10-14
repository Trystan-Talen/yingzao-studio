import { ProjectExport } from '../components/ProjectExport';
import { t } from '../lib/i18n';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Download,
  Edit3,
  FileText,
  FolderOpen,
  Heart,
  Image,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AssetDto, AssetTextDto, ProjectDto } from '../../contracts/core';
import {
  api,
  bytes,
  dateTime,
  downloadFile,
  downloadPost,
  errorMessage,
  patch,
  post,
  put,
  qs,
  remove,
  uploadAsset,
  useApi,
  useRefresh,
  type Page,
} from '../lib/api';
import { AssetVisual } from '../components/AssetPicker';
import {
  Badge,
  Button,
  Confirm,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  Segments,
  useAction,
  useToast,
} from '../components/ui';
import { useStudio } from '../context';
export function Projects() {
  const { canEdit } = useStudio();
  const [q, setQ] = useState('');
  const [selectedProjects, setSelectedProjects] = useState<ProjectDto[]>([]);
  const [projectExportOpen, setProjectExportOpen] = useState(false);
  const [kind, setKind] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<ProjectDto | 'new' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [projectKind, setProjectKind] = useState('image');
  const [deleting, setDeleting] = useState<ProjectDto | null>(null);
  const query = useApi<Page<ProjectDto>>(
    `/projects${qs({ q, kind, favorite: favorite || undefined, deleted: deleted || undefined, page })}`,
  );
  const assets = useApi<Page<AssetDto>>('/assets?pageSize=100');
  const refresh = useRefresh();
  const action = useAction();
  const navigate = useNavigate();
  const toast = useToast();
  function open(project: ProjectDto | 'new') {
    setEdit(project);
    setName(project === 'new' ? '' : project.name);
    setDescription(project === 'new' ? '' : project.description);
    setTags(project === 'new' ? '' : project.tags.join(', '));
    setProjectKind(project === 'new' ? 'image' : project.kind);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    await action.run(async () => {
      if (edit === 'new') {
        const project = await post<ProjectDto>('/projects', {
          name,
          description,
          kind: projectKind,
        });
        setEdit(null);
        await refresh();
        navigate(`/workbench/${project.id}`);
      } else if (edit) {
        await patch(`/projects/${edit.id}`, {
          name,
          description,
          tags: tags
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
        });
        setEdit(null);
        await refresh();
      }
    }, '项目已保存');
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="YOUR WORK, ALL TOGETHER"
        title={t('项目')}
        description={t('让每个想法都有自己的位置，随时回来继续创作。')}
        action={
          canEdit && (
            <Button onClick={() => open('new')}>
              <Plus size={17} />
              {t('新建项目')}
            </Button>
          )
        }
      />
      <div className="toolbar">
        <div className="filter-group">
          <input
            aria-label={t('搜索项目')}
            placeholder={t('搜索项目名称…')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label={t('项目类型')}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('全部类型')}</option>
            <option value="image">{t('图片项目')}</option>
            <option value="video">{t('视频项目')}</option>
            <option value="mixed">{t('混合创作')}</option>
          </select>
          <Button
            variant={favorite ? 'primary' : 'secondary'}
            onClick={() => {
              setFavorite(!favorite);
              setPage(1);
            }}
          >
            <Heart size={15} />
            {t('收藏')}
          </Button>
          <Button
            variant={deleted ? 'primary' : 'ghost'}
            onClick={() => {
              setDeleted(!deleted);
              setPage(1);
              setSelectedProjects([]);
            }}
          >
            <Trash2 size={15} />
            {t('回收站')}
          </Button>
        </div>
        <Segments
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: '网格' },
            { value: 'list', label: '列表' },
          ]}
        />
      </div>
      {selectedProjects.length > 0 && (
        <div className="selection-bar">
          <span>
            {t('已选择')} {selectedProjects.length} {t('个项目')}
          </span>
          <Button variant="secondary" onClick={() => setProjectExportOpen(true)}>
            <Download size={15} />
            {t('批量导出画布')}
          </Button>
          <Button variant="ghost" onClick={() => setSelectedProjects([])}>
            {t('清空选择')}
          </Button>
        </div>
      )}
      {projectExportOpen && (
        <ProjectExport projects={selectedProjects} onClose={() => setProjectExportOpen(false)} />
      )}
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : !query.data?.items.length ? (
        <Empty
          icon={<FolderOpen size={34} />}
          title={
            deleted
              ? t('回收站是空的')
              : q
                ? t('没有找到相关项目')
                : t('给下一个好想法，建一个项目')
          }
          description={t('项目会保存你的画布、版本和关联素材。')}
          action={
            canEdit &&
            !deleted && (
              <Button onClick={() => open('new')}>
                <Plus size={16} />
                {t('新建项目')}
              </Button>
            )
          }
        />
      ) : (
        <div className={view === 'grid' ? 'project-grid' : 'project-list'}>
          {query.data.items.map((project) => {
            const cover = assets.data?.items.find((a) => a.id === project.coverAssetId);
            return (
              <article key={project.id} className="project-card">
                {!deleted && (
                  <label className="project-select-control">
                    <input
                      type="checkbox"
                      aria-label={`${t('选择项目')} ${project.name}`}
                      checked={selectedProjects.some((item) => item.id === project.id)}
                      disabled={
                        selectedProjects.length >= 20 &&
                        !selectedProjects.some((item) => item.id === project.id)
                      }
                      onChange={(e) =>
                        setSelectedProjects(
                          e.target.checked
                            ? [...selectedProjects, project]
                            : selectedProjects.filter((item) => item.id !== project.id),
                        )
                      }
                    />
                    <span>{t('选择')}</span>
                  </label>
                )}
                <Link
                  to={`/workbench/${project.id}`}
                  className="project-cover"
                  aria-label={`打开${project.name}`}
                >
                  {cover ? (
                    <AssetVisual asset={cover} />
                  ) : (
                    <div className="project-placeholder">
                      <LayersMini />
                      <span>{project.kind === 'video' ? t('视频创作') : t('创作画布')}</span>
                    </div>
                  )}
                </Link>
                <div className="project-info">
                  <Link to={`/workbench/${project.id}`}>
                    <h3>{project.name}</h3>
                  </Link>
                  <p>
                    {dateTime(project.updatedAt)}
                    {t('更新')}
                  </p>
                  {project.tags.length > 0 && (
                    <div className="tag-list">
                      {project.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="card-actions">
                  {deleted ? (
                    <Button
                      variant="secondary"
                      disabled={!canEdit}
                      onClick={() =>
                        void action.run(async () => {
                          await post(`/projects/${project.id}/restore`);
                          await refresh();
                        }, '项目已恢复')
                      }
                    >
                      <RotateCcw size={15} />
                      {t('恢复')}
                    </Button>
                  ) : (
                    <>
                      <IconButton
                        label={project.isFavorite ? t('取消收藏') : t('收藏项目')}
                        onClick={() =>
                          void action.run(async () => {
                            await put(`/projects/${project.id}/favorite`, {
                              favorite: !project.isFavorite,
                            });
                            await refresh();
                          })
                        }
                      >
                        <Heart size={16} fill={project.isFavorite ? 'currentColor' : 'none'} />
                      </IconButton>
                      {canEdit && (
                        <>
                          <IconButton label={t('编辑项目')} onClick={() => open(project)}>
                            <Edit3 size={16} />
                          </IconButton>
                          <IconButton label={t('删除项目')} onClick={() => setDeleting(project)}>
                            <Trash2 size={16} />
                          </IconButton>
                        </>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
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
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit === 'new' ? t('新建项目') : t('编辑项目')}
      >
        <form onSubmit={save}>
          <Field label={t('项目名称')}>
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {edit === 'new' && (
            <Field label={t('项目类型')}>
              <select value={projectKind} onChange={(e) => setProjectKind(e.target.value)}>
                <option value="image">{t('图片')}</option>
                <option value="video">{t('视频')}</option>
                <option value="mixed">{t('混合创作')}</option>
              </select>
            </Field>
          )}
          <Field label={t('项目说明')}>
            <textarea
              maxLength={4000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {edit !== 'new' && (
            <Field label={t('标签')} hint={t('用逗号分隔')}>
              <input value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
          )}
          <div className="modal-actions">
            <Button type="submit" busy={action.busy}>
              {t('保存项目')}
            </Button>
          </div>
        </form>
      </Modal>
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('将项目移入回收站？')}
        description={t('项目内容会保留，可从回收站恢复。共用素材不会一同删除。')}
        busy={action.busy}
        onConfirm={() =>
          void action.run(async () => {
            if (!deleting) return;
            const id = deleting.id;
            await remove(`/projects/${id}`);
            setDeleting(null);
            await refresh();
            toast('项目已移入回收站', 'success', {
              label: '撤销',
              run: () =>
                void action.run(async () => {
                  await post(`/projects/${id}/restore`);
                  await refresh();
                }),
            });
          })
        }
      />
    </div>
  );
}
function LayersMini() {
  return (
    <svg width="58" height="58" viewBox="0 0 58 58" fill="none" aria-hidden="true">
      <rect x="10" y="12" width="32" height="36" rx="5" stroke="currentColor" opacity=".35" />
      <rect x="17" y="7" width="32" height="36" rx="5" fill="var(--panel)" stroke="currentColor" />
      <path d="m23 31 7-8 6 5 6-8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="27" cy="17" r="3" fill="currentColor" opacity=".5" />
    </svg>
  );
}
interface Collection {
  id: string;
  name: string;
}
export function Assets() {
  const { canEdit } = useStudio();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [tag, setTag] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [collection, setCollection] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<AssetDto | null>(null);
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newCollection, setNewCollection] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [managingCollection, setManagingCollection] = useState(false);
  const [removingCollection, setRemovingCollection] = useState(false);
  const [addTo, setAddTo] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const input = useRef<HTMLInputElement>(null);
  const query = useApi<Page<AssetDto>>(
    `/assets${qs({ q, kind, tag, collectionId: collection, favorite: favorite || undefined, deleted: deleted || undefined, page })}`,
  );
  const collections = useApi<Page<Collection>>('/collections?pageSize=100');
  const text = useApi<AssetTextDto>(
    `/assets/${detail?.id ?? ''}/text`,
    !!detail && detail.kind === 'document',
  );
  const refresh = useRefresh();
  const action = useAction();
  const toast = useToast();
  async function collectionIds(id: string) {
    const first = await api<Page<AssetDto>>(`/assets?collectionId=${id}&pageSize=100`);
    const items = [...first.items];
    for (let page = 2; items.length < first.total; page++) {
      const next = await api<Page<AssetDto>>(
        `/assets?collectionId=${id}&pageSize=100&page=${page}`,
      );
      if (!next.items.length) throw new Error('集合内容发生变化，请刷新后重试');
      items.push(...next.items);
    }
    return items.map((item) => item.id);
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    let count = 0;
    for (const file of Array.from(files)) {
      try {
        await uploadAsset(file);
        count++;
      } catch (error) {
        toast(`${file.name}：${errorMessage(error)}`, 'error');
      }
    }
    await refresh();
    if (count) toast(`已上传 ${count} 个真实文件`);
    setUploading(false);
    if (input.current) input.current.value = '';
  }
  function show(asset: AssetDto) {
    setDetail(asset);
    setName(asset.name);
    setTags(asset.tags.join(', '));
  }
  async function batchDelete() {
    await action.run(async () => {
      for (const id of selected) await remove(`/assets/${id}`);
      setSelected([]);
      setDeleting(false);
      await refresh();
    }, '所选素材已移入回收站');
  }
  async function downloadSelected() {
    await action.run(async () => {
      await downloadPost('/assets/download-zip', { assetIds: selected }, 'yingzao-assets.zip');
    }, '原始文件压缩包已下载');
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="THE BUILDING BLOCKS OF GREAT WORK"
        title={t('素材库')}
        description={t('收集、整理、复用。让好的素材，成为下一次创作的起点。')}
        action={
          canEdit && (
            <>
              <Button variant="secondary" onClick={() => setNewCollection(true)}>
                <FolderOpen size={16} />
                {t('新建集合')}
              </Button>
              <Button busy={uploading} onClick={() => input.current?.click()}>
                <Upload size={16} />
                {t('上传素材')}
              </Button>
            </>
          )
        }
      />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => void upload(e.target.files)}
      />
      <div className="toolbar">
        <div className="filter-group">
          <input
            placeholder={t('搜索素材…')}
            aria-label={t('搜索素材')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label={t('素材类型')}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('全部类型')}</option>
            <option value="image">{t('图片')}</option>
            <option value="video">{t('视频')}</option>
            <option value="audio">{t('音频')}</option>
            <option value="document">{t('文档')}</option>
          </select>
          <select
            aria-label={t('素材集合')}
            value={collection}
            onChange={(e) => {
              setCollection(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('全部集合')}</option>
            {collections.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {collection && canEdit && (
            <Button
              variant="ghost"
              onClick={() => {
                setCollectionName(
                  collections.data?.items.find((c) => c.id === collection)?.name ?? '',
                );
                setManagingCollection(true);
              }}
            >
              {t('管理集合')}
            </Button>
          )}
          <Button
            variant={favorite ? 'primary' : 'ghost'}
            onClick={() => {
              setFavorite(!favorite);
              setPage(1);
            }}
          >
            <Heart size={15} />
            {t('收藏')}
          </Button>
          <Button
            variant={deleted ? 'primary' : 'ghost'}
            onClick={() => {
              setDeleted(!deleted);
              setPage(1);
              setSelected([]);
            }}
          >
            <Trash2 size={15} />
            {t('回收站')}
          </Button>
        </div>
        <Segments
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: '网格' },
            { value: 'list', label: '列表' },
          ]}
        />
      </div>
      {selected.length > 0 && (
        <div className="selection-bar">
          <span>
            {t('已选择')}
            {selected.length}
            {t('项')}
          </span>
          <Button variant="ghost" onClick={() => void downloadSelected()} busy={action.busy}>
            <Download size={15} />
            {t('打包下载原件')}
          </Button>
          {canEdit && !deleted && (
            <>
              <Button variant="ghost" onClick={() => setAddTo(true)}>
                {t('加入集合')}
              </Button>
              {collection && (
                <Button
                  variant="ghost"
                  busy={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const ids = await collectionIds(collection);
                      await put(`/collections/${collection}/assets`, {
                        assetIds: ids.filter((id) => !selected.includes(id)),
                      });
                      setSelected([]);
                      await refresh();
                    }, '已移出集合')
                  }
                >
                  {t('移出当前集合')}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                <Trash2 size={15} />
                {t('删除')}
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => setSelected([])}>
            {t('取消选择')}
          </Button>
        </div>
      )}
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : !query.data?.items.length ? (
        <Empty
          icon={<Image size={34} />}
          title={deleted ? t('回收站暂无素材') : t('好素材，是好创作的开始')}
          description={t('上传图片、视频、音频或参考文档，所有原件均保留。')}
          action={
            canEdit &&
            !deleted && (
              <Button onClick={() => input.current?.click()} busy={uploading}>
                <Upload size={16} />
                {t('上传第一份素材')}
              </Button>
            )
          }
        />
      ) : (
        <div className={view === 'grid' ? 'asset-grid' : 'asset-list'}>
          {query.data.items.map((asset) => (
            <article
              className={`asset-card ${selected.includes(asset.id) ? 'is-selected' : ''}`}
              key={asset.id}
            >
              <button
                className="asset-preview"
                onClick={() => show(asset)}
                aria-label={`查看${asset.name}`}
              >
                <AssetVisual asset={asset} />
              </button>
              <label className="asset-checkbox">
                <input
                  type="checkbox"
                  checked={selected.includes(asset.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, asset.id]
                        : selected.filter((id) => id !== asset.id),
                    )
                  }
                  aria-label={`选择${asset.name}`}
                />
              </label>
              <div className="asset-info">
                <h3 title={asset.name}>{asset.name}</h3>
                <p>
                  {asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ''}
                  {bytes(asset.byteSize)}
                </p>
                <div className="tag-list">
                  {asset.tags.map((t) => (
                    <button key={t} onClick={() => setTag(tag === t ? '' : t)}>
                      <Badge>{t}</Badge>
                    </button>
                  ))}
                </div>
              </div>
              <div className="card-actions">
                {deleted ? (
                  <Button
                    variant="secondary"
                    disabled={!canEdit}
                    onClick={() =>
                      void action.run(async () => {
                        await post(`/assets/${asset.id}/restore`);
                        await refresh();
                      }, '素材已恢复')
                    }
                  >
                    <RotateCcw size={14} />
                    {t('恢复')}
                  </Button>
                ) : (
                  <>
                    <IconButton
                      label={asset.isFavorite ? t('取消收藏') : t('收藏素材')}
                      onClick={() =>
                        void action.run(async () => {
                          await put(`/assets/${asset.id}/favorite`, {
                            favorite: !asset.isFavorite,
                          });
                          await refresh();
                        })
                      }
                    >
                      <Heart size={16} fill={asset.isFavorite ? 'currentColor' : 'none'} />
                    </IconButton>
                    <IconButton
                      label={t('下载原件')}
                      onClick={() =>
                        void action.run(
                          () => downloadFile(asset.originalUrl, asset.name),
                          '已下载原件',
                        )
                      }
                    >
                      <Download size={16} />
                    </IconButton>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {query.data && (
        <Pagination
          page={page}
          total={query.data.total}
          pageSize={query.data.pageSize}
          onPage={setPage}
        />
      )}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={t('素材详情')} wide>
        {detail && (
          <div className="asset-detail">
            <div className="asset-detail-preview">
              {detail.kind === 'image' ? (
                <img src={detail.previewUrl ?? detail.originalUrl} alt={detail.name} />
              ) : detail.kind === 'video' ? (
                <video src={detail.originalUrl} controls />
              ) : detail.kind === 'audio' ? (
                <audio src={detail.originalUrl} controls />
              ) : (
                <div className="document-preview">
                  <FileText size={36} />
                  {text.isLoading ? (
                    <Loading />
                  ) : text.error ? (
                    <ErrorState error={text.error} />
                  ) : (
                    <>
                      <Badge>
                        {text.data?.extractionStatus === 'ready'
                          ? t('已提取正文')
                          : text.data?.extractionStatus === 'failed'
                            ? t('提取失败')
                            : t('正在提取')}
                      </Badge>
                      {text.data?.extractionError && (
                        <Notice tone="warning">{text.data.extractionError.message}</Notice>
                      )}
                      <pre>{text.data?.extractedText ?? '文档原件已保存。'}</pre>
                      {text.data?.truncated && (
                        <Notice>{t('正文较长，当前显示经过截断的内容。')}</Notice>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  await patch(`/assets/${detail.id}`, {
                    name,
                    tags: tags
                      .split(/[,，]/)
                      .map((t) => t.trim())
                      .filter(Boolean),
                  });
                  setDetail(null);
                  await refresh();
                }, '素材信息已保存');
              }}
            >
              <Field label={t('名称')}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={!canEdit}
                />
              </Field>
              <Field label={t('标签')} hint={t('用逗号分隔')}>
                <input value={tags} onChange={(e) => setTags(e.target.value)} disabled={!canEdit} />
              </Field>
              <dl className="detail-list">
                <div>
                  <dt>{t('文件格式')}</dt>
                  <dd>{detail.mimeType}</dd>
                </div>
                <div>
                  <dt>{t('原件大小')}</dt>
                  <dd>{bytes(detail.byteSize)}</dd>
                </div>
                <div>
                  <dt>{t('来源')}</dt>
                  <dd>
                    {
                      {
                        upload: '上传',
                        generation: 'AI生成',
                        'local-processing': '本机处理',
                        import: '导入',
                      }[detail.source]
                    }
                  </dd>
                </div>
                <div>
                  <dt>{t('创建时间')}</dt>
                  <dd>{dateTime(detail.createdAt)}</dd>
                </div>
              </dl>
              <div className="inline-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void action.run(
                      () => downloadFile(detail.originalUrl, detail.name),
                      '已下载原件',
                    )
                  }
                >
                  <Download size={15} />
                  {t('下载')}
                </Button>
                {canEdit && (
                  <Button type="submit" busy={action.busy}>
                    {t('保存信息')}
                  </Button>
                )}
              </div>
            </form>
          </div>
        )}
      </Modal>
      <Modal open={newCollection} onClose={() => setNewCollection(false)} title={t('新建素材集合')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await post('/collections', { name: collectionName });
              setNewCollection(false);
              setCollectionName('');
              await refresh();
            }, '集合已创建');
          }}
        >
          <Field label={t('集合名称')}>
            <input
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              required
              maxLength={120}
            />
          </Field>
          <div className="modal-actions">
            <Button type="submit" busy={action.busy}>
              {t('创建集合')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={managingCollection}
        onClose={() => setManagingCollection(false)}
        title={t('管理素材集合')}
      >
        <Field label={t('集合名称')}>
          <input
            maxLength={80}
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
          />
        </Field>
        <div className="modal-actions">
          <Button variant="danger" onClick={() => setRemovingCollection(true)}>
            {t('删除集合')}
          </Button>
          <Button
            disabled={!collectionName.trim()}
            busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                await patch(`/collections/${collection}`, { name: collectionName });
                setManagingCollection(false);
                await refresh();
              }, '集合已更新')
            }
          >
            {t('保存名称')}
          </Button>
        </div>
      </Modal>
      <Confirm
        open={removingCollection}
        onClose={() => setRemovingCollection(false)}
        title={t('删除素材集合')}
        description={t('集合会删除，其中的原始素材仍保留在素材库。')}
        onConfirm={() => {
          void action.run(async () => {
            await remove(`/collections/${collection}`);
            setRemovingCollection(false);
            setManagingCollection(false);
            setCollection('');
            setSelected([]);
            await refresh();
          }, '集合已删除');
        }}
      />
      <Modal open={addTo} onClose={() => setAddTo(false)} title={t('加入素材集合')}>
        <p className="muted">{t('现有素材会保留，新选择的素材会合并加入。')}</p>
        {collections.data?.items.map((item) => (
          <button
            key={item.id}
            className="search-result"
            onClick={() =>
              void action.run(async () => {
                const existing = await collectionIds(item.id);
                await put(`/collections/${item.id}/assets`, {
                  assetIds: [...new Set([...existing, ...selected])],
                });
                setAddTo(false);
                setSelected([]);
                await refresh();
              }, '素材已加入集合')
            }
          >
            <FolderOpen size={18} />
            {item.name}
          </button>
        ))}
        {!collections.data?.items.length && <Empty title={t('请先创建一个集合')} />}
      </Modal>
      <Confirm
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`删除 ${selected.length} 个素材？`}
        description={t(
          '素材将移入回收站。引用这些素材的画布可能显示缺失，可通过恢复素材重新显示。',
        )}
        busy={action.busy}
        onConfirm={() => void batchDelete()}
      />
    </div>
  );
}
