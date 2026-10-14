import { useStudio } from '../context';
import { parseOcrResult } from './OCRResultPanel';
import { t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  FileType,
  Layers3,
  Languages,
  Maximize,
  Plus,
  ScanText,
  Scissors,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react';
import type { AssetDto, ProjectDto } from '../../contracts/core';
import { LANGUAGES } from '../../contracts/catalog';
import { jobInput, type Capabilities, type Job, type JobInput } from '../lib/tasks';
import { api, post, qs, useApi, type Page } from '../lib/api';
import { AssetPicker } from './AssetPicker';
import { JobSubmit } from './JobSubmit';
import { JobCard } from './TaskCenter';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeader,
  useAction,
} from './ui';
export const advancedTools = [
  {
    id: 'image.ocr',
    name: '图片文字识别',
    description: '读取图片中的文字，保留真实识别结果',
    icon: ScanText,
    kind: 'image',
  },
  {
    id: 'image.text-edit',
    name: '图片改字',
    description: '替换指定文字与区域，保留画面风格',
    icon: FileType,
    kind: 'image',
  },
  {
    id: 'image.layers',
    name: '图层拆分',
    description: '将图片拆解成可独立使用的元素',
    icon: Layers3,
    kind: 'image',
  },
  {
    id: 'video.extend',
    name: '视频延长',
    description: '从已有片段继续生成后续内容',
    icon: Video,
    kind: 'video',
  },
  {
    id: 'video.edit',
    name: '视频编辑',
    description: '按描述调整视频画面与场景',
    icon: Sparkles,
    kind: 'video',
  },
  {
    id: 'video.upscale',
    name: '视频超分',
    description: '改善原视频分辨率与清晰度',
    icon: Maximize,
    kind: 'video',
  },
  {
    id: 'video.erase-subtitles',
    name: '视频去字幕',
    description: '使用通用编辑模型处理短视频文字区域，效果需预览确认',
    icon: Scissors,
    kind: 'video',
  },
  {
    id: 'video.translate',
    name: '视频翻译',
    description: '将视频中的语言转换为目标语言',
    icon: Languages,
    kind: 'video',
  },
] as const;
export function AdvancedToolCards() {
  return (
    <section className="section-spaced">
      <div className="section-heading">
        <div>
          <h2>{t('进阶工作流')}</h2>
          <p className="muted">{t('从文字识别到视频后期，连接对应服务后执行。')}</p>
        </div>
        <Badge>{t('图片与视频')}</Badge>
      </div>
      <div className="tools-grid">
        {advancedTools.map((tool) => (
          <Link to={`/advanced/${tool.id}`} className="tool-card" key={tool.id}>
            <span className="tool-icon" style={{ background: '#eaf1ec' }}>
              <tool.icon size={24} />
            </span>
            <div className="tool-title">
              <h3>{t(tool.name)}</h3>
              <ArrowUpRight size={16} />
            </div>
            <p>{t(tool.description)}</p>
            <Badge>{tool.kind === 'image' ? t('图片处理') : t('视频后期')}</Badge>
          </Link>
        ))}
      </div>
    </section>
  );
}
interface TextReplacement {
  originalText: string;
  replaceText: string;
  rect: [number, number, number, number];
}
export function AdvancedToolPage() {
  const { operationId } = useParams();
  const tool = advancedTools.find((item) => item.id === operationId);
  if (!tool)
    return (
      <div className="page">
        <Empty title={t('未找到此工作流')} action={<Link to="/tools">{t('返回工具箱')}</Link>} />
      </div>
    );
  return <AdvancedToolForm key={tool.id} tool={tool} />;
}
function AdvancedToolForm({ tool }: { tool: (typeof advancedTools)[number] }) {
  const { canEdit } = useStudio();
  const [search] = useSearchParams();
  const projectId = search.get('projectId') ?? undefined;
  const ocrJobId = search.get('ocrJobId');
  const ocrSourceKey = `${ocrJobId ?? ''}:${search.get('ocrItemId') ?? ''}:${search.get('region') ?? '0'}`;
  const ocrJob = useApi<Job>(
    `/jobs/${ocrJobId ?? ''}`,
    !!ocrJobId && tool.id === 'image.text-edit',
  );
  const [ocrLoaded, setOcrLoaded] = useState('');
  const navigate = useNavigate();
  const action = useAction();
  const savedDraft = useApi<Page<{ createdAt: string; metadata?: { draft?: JobInput } }>>(
    `/projects/${projectId}/messages?pageSize=100`,
    !!projectId,
  );
  const [restored, setRestored] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [prompt, setPrompt] = useState('');
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [language, setLanguage] = useState('en');
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState('1080p');
  const [scale, setScale] = useState(2);
  const [replacements, setReplacements] = useState<TextReplacement[]>([
    { originalText: '', replaceText: '', rect: [0, 0, 100, 40] },
  ]);
  useEffect(() => {
    if (ocrJobId || restored || !savedDraft.data) return;
    const draft = savedDraft.data.items
      .filter((m) => m.metadata?.draft)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.metadata?.draft;
    if (!draft) return;
    setRestored(true);
    setPrompt(draft.prompt);
    setProviderId(draft.providerId);
    setModelId(draft.options.model ?? '');
    setLanguage(draft.options.language);
    setDuration(draft.options.duration);
    setResolution(draft.options.resolution);
    setScale(draft.options.scale);
    setReplacements(draft.options.textReplacements ?? []);
    void Promise.all([
      Promise.all(draft.assetIds.map((id) => api<AssetDto>(`/assets/${id}`))),
      Promise.all(draft.referenceAssetIds.map((id) => api<AssetDto>(`/assets/${id}`))),
    ])
      .then(([sources, refs]) => {
        setAssets(sources);
        setReferences(refs);
      })
      .catch((e) => setRestoreError(e instanceof Error ? e.message : '草稿素材读取失败'));
  }, [restored, savedDraft.data]);
  useEffect(() => {
    if (!ocrJob.data || !ocrJobId || ocrLoaded === ocrSourceKey || tool.id !== 'image.text-edit')
      return;
    const item =
      ocrJob.data.items.find((item) => item.id === search.get('ocrItemId')) ??
      ocrJob.data.items.find((item) => item.resultText);
    const result = item?.resultText ? parseOcrResult(item.resultText) : null;
    if (!result) {
      setRestoreError('该任务没有可导入的结构化文字区域。');
      setOcrLoaded(ocrSourceKey);
      return;
    }
    const index = Math.max(
      0,
      Math.min(result.regions.length - 1, Number(search.get('region')) || 0),
    );
    const region = result.regions[index];
    if (!region) {
      setRestoreError('该任务没有可导入的结构化文字区域。');
      setOcrLoaded(ocrSourceKey);
      return;
    }
    let cancelled = false;
    void api<AssetDto>(`/assets/${result.imageAssetId}`)
      .then((asset) => {
        if (cancelled) return;
        setAssets([asset]);
        setReplacements([{ originalText: region.text, replaceText: '', rect: region.rect }]);
        setOcrLoaded(ocrSourceKey);
      })
      .catch((error) => {
        if (!cancelled)
          setRestoreError(error instanceof Error ? error.message : '草稿素材读取失败');
      });
    return () => {
      cancelled = true;
    };
  }, [ocrJob.data, ocrJobId, ocrLoaded, ocrSourceKey, tool.id, search]);
  const caps = useApi<Capabilities>('/capabilities');
  const operations = caps.data?.operations.filter((item) => item.id === tool.id) ?? [];
  const operation =
    operations.find((item) => item.providerId === providerId) ??
    operations.find((item) => item.available) ??
    operations[0];
  const model = operation?.models.find((item) => item.id === modelId) ?? operation?.models[0];
  const history = useApi<Page<Job>>(`/jobs${qs({ operation: tool.id, pageSize: 30 })}`, true, 5000);
  const actualDuration =
    model?.durations.includes(duration) || !model?.durations.length ? duration : model.durations[0];
  const actualResolution =
    model?.resolutions.includes(resolution) || !model?.resolutions.length
      ? resolution
      : model.resolutions[0];
  const input = jobInput({
    operation: tool.id,
    providerId: operation?.providerId ?? 'flyelep',
    prompt,
    ...(projectId ? { projectId } : {}),
    assetIds: assets.map((a) => a.id),
    referenceAssetIds: references.map((a) => a.id),
    options: {
      model: model?.id,
      language,
      duration: actualDuration,
      resolution: actualResolution,
      scale,
      ...(tool.id === 'image.text-edit' ? { textReplacements: replacements } : {}),
    },
  });
  const valid =
    assets.length > 0 &&
    (tool.id !== 'video.erase-subtitles' ||
      (!!assets[0]?.durationMs &&
        assets[0].durationMs > 0 &&
        assets[0].durationMs < 5000 &&
        prompt.length <= 1000)) &&
    (tool.id !== 'image.text-edit' ||
      (replacements.length > 0 &&
        replacements.every(
          (item) =>
            item.rect[0] >= 0 &&
            item.rect[1] >= 0 &&
            item.rect[2] > 0 &&
            item.rect[3] > 0 &&
            item.rect[0] + item.rect[2] <= (assets[0]?.width ?? 32768) &&
            item.rect[1] + item.rect[3] <= (assets[0]?.height ?? 32768),
        ))) &&
    (tool.id !== 'image.text-edit' ||
      replacements.every((item) => item.originalText.trim() && item.replaceText.trim()));
  async function saveDraft() {
    await action.run(async () => {
      const project = projectId
        ? await api<ProjectDto>(`/projects/${projectId}`)
        : await post<ProjectDto>('/projects', {
            name: tool.name,
            kind: tool.kind,
            description: prompt,
          });
      await post(`/projects/${project.id}/messages`, {
        role: 'user',
        content: prompt || tool.name,
        metadata: { draft: input },
      });
      navigate(`/workbench/${project.id}`);
    }, '工具草稿已保存');
  }
  return (
    <div className="page">
      {restoreError && <Notice tone="warning">{restoreError}</Notice>}
      <Link to="/tools" className="back-link">
        <ArrowLeft size={16} />
        {t('全部工具')}
      </Link>
      <PageHeader
        title={t(tool.name)}
        description={t(tool.description)}
        action={
          <Button
            variant="secondary"
            busy={action.busy}
            disabled={!canEdit}
            onClick={() => void saveDraft()}
          >
            {t('保存为项目')}
          </Button>
        }
      />
      <div className="tool-workspace">
        <section className="panel tool-form">
          <div className="panel-heading">
            <h2>{t('输入与参数')}</h2>
            <Badge>{tool.kind === 'video' ? t('视频后期') : t('图片处理')}</Badge>
          </div>
          <AssetPicker
            value={assets}
            onChange={(next) => {
              if (tool.id === 'image.text-edit' && next[0]?.id !== assets[0]?.id)
                setReplacements([{ originalText: '', replaceText: '', rect: [0, 0, 100, 40] }]);
              setAssets(next);
            }}
            label={tool.kind === 'image' ? t('原始图片') : t('原始视频')}
            kind={tool.kind}
            max={1}
          />
          {(tool.id === 'video.edit' || tool.id === 'video.extend') && (
            <AssetPicker
              value={references}
              onChange={setReferences}
              label={tool.id === 'video.extend' ? t('尾帧参考（可选）') : t('参考图片（可选）')}
              max={tool.id === 'video.extend' ? 1 : 4}
            />
          )}
          <Field label={t('处理说明')}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={tool.id === 'video.erase-subtitles' ? 1000 : 12000}
              rows={3}
              placeholder={
                tool.id === 'image.ocr'
                  ? t('可选：说明需要关注的文字区域')
                  : t('描述你希望得到的结果…')
              }
            />
          </Field>
          <Field label={t('处理服务')}>
            <select
              value={operation?.providerId ?? ''}
              onChange={(e) => {
                setProviderId(e.target.value);
                setModelId('');
              }}
            >
              {!operations.length && (
                <option value="">
                  {caps.isLoading ? t('正在加载能力…') : t('当前暂无已连接的适配能力')}
                </option>
              )}
              {operations.map((item) => (
                <option key={item.providerId} value={item.providerId}>
                  {t(item.name)} · {item.providerId}
                  {item.available ? '' : t('（未连接）')}
                </option>
              ))}
            </select>
          </Field>
          {model && (
            <Field label={t('模型')}>
              <select value={model.id} onChange={(e) => setModelId(e.target.value)}>
                {operation?.models.map((item) => (
                  <option value={item.id} key={item.id}>
                    {t(item.name)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {tool.id === 'video.erase-subtitles' && (
            <Notice
              tone={
                assets[0] && (!assets[0].durationMs || assets[0].durationMs >= 5000)
                  ? 'warning'
                  : 'info'
              }
            >
              {t('Bria · 短片文字区域擦除')}
              <br />
              {t(
                '仅支持小于 5 秒的源视频，保留音轨，不会自动裁短。通用编辑模型的处理效果需要预览确认，不保证无痕去字幕。',
              )}
              {assets[0] && (!assets[0].durationMs || assets[0].durationMs >= 5000) && (
                <p>{t('请先裁剪视频到 5 秒以下，再提交处理。')}</p>
              )}
            </Notice>
          )}
          {tool.id === 'video.extend' && (
            <Field label={t('延长时长（秒）')}>
              <select value={actualDuration} onChange={(e) => setDuration(Number(e.target.value))}>
                {(model?.durations.length ? model.durations : [5, 10]).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
          )}
          {tool.id === 'video.upscale' && (
            <div className="form-grid">
              <Field label={t('放大倍数')}>
                <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                  {[2, 4, 8].map((value) => (
                    <option key={value} value={value}>
                      {value}×
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('预计输出尺寸')}>
                <input
                  readOnly
                  value={
                    assets[0]?.width && assets[0]?.height
                      ? `${assets[0].width * scale} × ${assets[0].height * scale}`
                      : t('选择源视频后显示')
                  }
                />
              </Field>
            </div>
          )}
          {tool.id === 'video.translate' && (
            <Field label={t('目标语言')}>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t(item.name)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {tool.id === 'image.text-edit' && (
            <div className="replacement-list">
              <div className="section-heading">
                <h3>{t('文字替换')}</h3>
                <Button
                  variant="ghost"
                  disabled={replacements.length >= 100}
                  onClick={() =>
                    setReplacements([
                      ...replacements,
                      { originalText: '', replaceText: '', rect: [0, 0, 100, 40] },
                    ])
                  }
                >
                  <Plus size={14} />
                  {t('添加')}
                </Button>
              </div>
              {replacements.map((item, index) => (
                <div className="replacement-row" key={index}>
                  <div className="form-grid">
                    <Field label={`${t('原文字')} ${index + 1}`}>
                      <input
                        value={item.originalText}
                        maxLength={1000}
                        onChange={(e) =>
                          setReplacements(
                            replacements.map((r, i) =>
                              i === index ? { ...r, originalText: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label={t('替换为')}>
                      <input
                        value={item.replaceText}
                        maxLength={1000}
                        onChange={(e) =>
                          setReplacements(
                            replacements.map((r, i) =>
                              i === index ? { ...r, replaceText: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </Field>
                  </div>
                  <div className="replacement-coordinates">
                    {['X', 'Y', '宽度', '高度'].map((label, position) => (
                      <Field key={label} label={t(label)}>
                        <input
                          type="number"
                          min={position < 2 ? 0 : 1}
                          max={32768}
                          value={item.rect[position]}
                          onChange={(e) =>
                            setReplacements(
                              replacements.map((r, i) => {
                                if (i !== index) return r;
                                const rect = [...r.rect] as TextReplacement['rect'];
                                rect[position] = Math.max(
                                  position < 2 ? 0 : 1,
                                  Math.min(32768, Number(e.target.value) || 0),
                                );
                                return { ...r, rect };
                              }),
                            )
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    disabled={replacements.length === 1}
                    onClick={() => setReplacements(replacements.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={13} />
                    {t('移除')}
                  </Button>
                </div>
              ))}
              <Notice>
                {t(
                  '区域坐标为原图像素的 X、Y、宽、高。识别结果中的四角坐标需要先换算，不能直接填入这里。',
                )}
              </Notice>
            </div>
          )}
          {tool.id === 'image.layers' && (
            <Notice>
              {t('模型输出 4 个独立图层，一次请求统一结算；应用到画布时将作为可展开的组合插入。')}
            </Notice>
          )}
          <JobSubmit input={input} operation={operation} valid={valid} label={t('开始处理')} />
        </section>
        <section className="tool-results">
          <h2 className="section-heading">{t('处理记录')}</h2>
          {history.isLoading ? (
            <Loading />
          ) : history.error ? (
            <ErrorState error={history.error} />
          ) : history.data?.items.length ? (
            history.data.items
              .filter((job) => job.operation === tool.id)
              .map((job) => <JobCard key={job.id} job={job} />)
          ) : (
            <Empty
              title={t('准备好素材，开始下一步')}
              description={t('真实处理结果与文字输出会保存在任务记录中。')}
            />
          )}
        </section>
      </div>
    </div>
  );
}
