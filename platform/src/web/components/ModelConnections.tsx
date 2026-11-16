import { useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Image,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Plus,
  Trash2,
  Save,
  Text,
  Video,
} from 'lucide-react';
import type {
  ModelConnectionDto,
  ModelConnectionKind,
  ModelConnectionProtocol,
  ModelFallbackResourceDto,
} from '../../contracts/model-connections';
import { isKnownSeedreamModel } from '../../contracts/model-connections';
import { useStudio } from '../context';
import {
  api,
  apiQueryKey,
  dateTime,
  errorMessage,
  useApi,
  useRefresh,
  type Page,
} from '../lib/api';
import { t } from '../lib/i18n';
import { useModelDirectory } from '../lib/use-model-directory';
import { DemoModeGenerationNotice } from './DemoModeGenerationNotice';
import { ModelPicker } from './ModelPicker';
import { Badge, Button, Empty, ErrorState, Field, IconButton, Loading } from './ui';
import '../styles/model-connections.css';

const stages = [
  { kind: 'text', title: '文本规划', description: '理解需求，整理画面与镜头提示词。', icon: Text },
  { kind: 'image', title: '图片生成', description: '生成图片，也为视频准备首帧。', icon: Image },
  { kind: 'video', title: '视频生成', description: '结合首帧与运动描述生成视频。', icon: Video },
] as const;

const protocolNames = {
  'openai-chat': 'OpenAI（开放人工智能）兼容文本接口',
  'openai-images': 'OpenAI（开放人工智能）兼容图片接口',
  'seedream-images': 'Seedream（豆包图像模型）图片接口',
  'seedance-native': 'Seedance（即梦视频模型）原生任务接口',
} as const;

type Draft = {
  name: string;
  baseUrl: string;
  modelsUrl: string;
  protocol: ModelConnectionProtocol;
  model: string;
  visionModel: string;
  enabled: boolean;
  secret: string;
  removeSecret: boolean;
};

function makeDraft(connection: ModelConnectionDto): Draft {
  return {
    name: 'name' in connection ? String(connection.name) : '首选资源',
    baseUrl: connection.baseUrl,
    modelsUrl: connection.modelsUrl,
    protocol: connection.protocol,
    model: connection.model,
    visionModel: connection.visionModel ?? '',
    enabled: connection.enabled,
    secret: '',
    removeSecret: false,
  };
}

export function ModelConnections() {
  const { isAdmin, workspace } = useStudio();
  const connections = useApi<Page<ModelConnectionDto>>('/model-connections', isAdmin);
  if (!isAdmin)
    return (
      <Empty
        icon={<KeyRound size={32} />}
        title={t('模型配置由空间管理员管理')}
        description={t('需要接入或更换模型时，请联系当前空间的创建者或管理员。')}
      />
    );
  if (connections.isLoading) return <Loading />;
  if (connections.error && !connections.data)
    return <ErrorState error={connections.error} retry={connections.refetch} />;
  if (!connections.data || !workspace) return null;
  return (
    <>
      {connections.error && <ErrorState error={connections.error} retry={connections.refetch} />}
      <DemoModeGenerationNotice />
      <ModelConnectionEditor
        key={workspace.id}
        workspaceId={workspace.id}
        connections={connections.data.items}
      />
    </>
  );
}

function ModelConnectionEditor({
  workspaceId,
  connections,
}: {
  workspaceId: string;
  connections: ModelConnectionDto[];
}) {
  const { session } = useStudio();
  const [kind, setKind] = useState<ModelConnectionKind>('text');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selectedResourceId, setResourceId] = useState('primary');
  const [resourceDrafts, setResourceDrafts] = useState<
    Partial<Record<ModelConnectionKind, ModelFallbackResourceDto[]>>
  >({});
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const requestActive = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  const inputId = useId();
  const primary = connections.find((item) => item.kind === kind);
  const resources = resourceDrafts[kind] ?? primary?.fallbackResources ?? [];
  const resourceId =
    selectedResourceId === 'primary' || resources.some((item) => item.id === selectedResourceId)
      ? selectedResourceId
      : 'primary';
  const connection =
    resourceId === 'primary' ? primary : resources.find((item) => item.id === resourceId);
  const draftKey = `${kind}:${resourceId}`;
  const preview = useModelDirectory(workspaceId, connection, drafts[draftKey], busy, resourceId);
  if (!connection || !primary)
    return <ErrorState error={new Error(t('模型配置不完整，请刷新页面。'))} />;
  const draft = drafts[draftKey] ?? makeDraft(connection);
  const stage = stages.find((item) => item.kind === kind)!;
  const directory = preview.isDraft
    ? (preview.result ?? {
        models: [],
        modelsCheckedAt: null,
        discoveryStatus: 'never',
        discoveryMessage: '填写服务地址与密钥后将自动获取模型列表。',
      })
    : connection;
  const models = directory.models;
  const directoryLoading = preview.loading || discoveryBusy;
  const directoryError =
    preview.error ||
    (directory.discoveryStatus !== 'never' && directory.discoveryStatus !== 'connected'
      ? directory.discoveryMessage
      : null);
  const canDiscover = preview.isDraft
    ? preview.canDiscover
    : connection.configured && !!connection.baseUrl;
  const hasChanges =
    !!resourceDrafts[kind] || Object.keys(drafts).some((key) => key.startsWith(`${kind}:`));

  function acceptConnection(value: ModelConnectionDto) {
    // The mutation response is authoritative even when the following refresh fails.
    // Cache only the redacted DTO, scoped to the workspace that initiated this save.
    queryClient.setQueryData<Page<ModelConnectionDto>>(
      apiQueryKey('/model-connections', workspaceId, session?.user.id ?? null),
      (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.kind === value.kind ? value : item)),
            }
          : current,
    );
  }

  function update(change: Partial<Draft>) {
    setDrafts((old) => ({ ...old, [draftKey]: { ...draft, ...change } }));
    setError(null);
    setMessage(null);
  }
  function chooseResource(id: string) {
    setResourceId(id);
    setShowSecret(false);
    setError(null);
    setMessage(null);
  }
  function addResource() {
    if (!primary || resources.length >= 2) return;
    const resource: ModelFallbackResourceDto = {
      id: crypto.randomUUID(),
      name: `备用资源 ${resources.length + 1}`,
      kind,
      protocol: primary.protocol,
      baseUrl: '',
      modelsUrl: '',
      model: primary.model,
      enabled: false,
      configured: false,
      keyHint: null,
      revision: null,
      updatedAt: null,
      models: [],
      modelsCheckedAt: null,
      discoveryStatus: 'never',
      discoveryMessage: '',
    };
    setResourceDrafts((old) => ({ ...old, [kind]: [...resources, resource] }));
    chooseResource(resource.id);
  }
  function removeResource() {
    setResourceDrafts((old) => ({
      ...old,
      [kind]: resources.filter((item) => item.id !== resourceId),
    }));
    setDrafts((old) => {
      const next = { ...old };
      delete next[draftKey];
      return next;
    });
    chooseResource('primary');
  }
  function resourceInput(value: ModelConnectionDto, id: string) {
    const current = drafts[`${kind}:${id}`] ?? makeDraft(value);
    return {
      protocol: current.protocol,
      baseUrl: current.baseUrl.trim(),
      modelsUrl: current.modelsUrl.trim(),
      model: current.model.trim(),
      ...(kind === 'text' ? { visionModel: current.visionModel.trim() } : {}),
      enabled: current.enabled,
      ...(current.secret.trim() ? { secret: current.secret.trim() } : {}),
      ...(current.removeSecret ? { removeSecret: true } : {}),
    };
  }
  function selectModel(model: string) {
    update({
      model,
      ...(kind === 'image' && isKnownSeedreamModel(model) ? { protocol: 'seedream-images' } : {}),
      ...(kind === 'image' && /^gpt-image(?:[-_.]|$)/i.test(model.trim())
        ? { protocol: 'openai-images' }
        : {}),
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    await run(submitter?.getAttribute('value') === 'discover' ? 'save-discover' : 'save');
  }

  async function run(mode: 'save' | 'save-discover' | 'discover') {
    if (requestActive.current || !connection || !primary) return;
    requestActive.current = true;
    setBusy(true);
    setDiscoveryBusy(mode === 'discover');
    setError(null);
    setMessage(null);
    let saved = false;
    try {
      if (mode !== 'discover') {
        const result = await api<ModelConnectionDto>(
          '/model-connections',
          {
            method: 'PUT',
            body: JSON.stringify({
              kind,
              ...resourceInput(primary, 'primary'),
              fallbackResources: resources.map((item) => ({
                id: item.id,
                name: (drafts[`${kind}:${item.id}`]?.name ?? item.name).trim(),
                ...resourceInput(item, item.id),
              })),
            }),
          },
          workspaceId,
        );
        acceptConnection(result);
        saved = true;
        setDrafts((old) => {
          const next = { ...old };
          for (const key of Object.keys(next)) if (key.startsWith(`${kind}:`)) delete next[key];
          return next;
        });
        setResourceDrafts((old) => {
          const next = { ...old };
          delete next[kind];
          return next;
        });
        setShowSecret(false);
      }
      if (mode !== 'save') {
        setDiscoveryBusy(true);
        const result = await api<ModelConnectionDto>(
          `/model-connections/${kind}/models`,
          {
            method: 'POST',
            ...(resourceId !== 'primary' ? { body: JSON.stringify({ resourceId }) } : {}),
          },
          workspaceId,
        );
        acceptConnection(result);
        const refreshed =
          resourceId === 'primary'
            ? result
            : result.fallbackResources?.find((item) => item.id === resourceId);
        setMessage(
          refreshed?.discoveryStatus === 'connected'
            ? t(saved ? '配置已保存，模型目录已同步。' : '模型目录已同步。')
            : t(
                saved
                  ? '配置已保存，模型目录暂未同步。可以手动填写模型标识。'
                  : '模型目录暂未同步。可以手动填写模型标识。',
              ),
        );
      } else setMessage(t('模型配置已保存。'));
    } catch (cause) {
      if (saved) setMessage(t('配置已保存，模型目录暂未同步。可以手动填写模型标识。'));
      setError(errorMessage(cause));
    } finally {
      await refresh();
      requestActive.current = false;
      setBusy(false);
      setDiscoveryBusy(false);
    }
  }

  return (
    <div className="model-connections section-spaced">
      <div className="model-connections-intro">
        <h2>{t('连接创作模型')}</h2>
        <p>{t('分别连接文本、图片和视频服务，可使用同一中转站，也可独立配置。')}</p>
        <p>{t('图片生成需启用图片服务；视频生成还需视频服务。开启思考模式时才需要文本规划。')}</p>
      </div>
      <div className="model-connection-stages" role="group" aria-label={t('模型用途')}>
        {stages.map(({ kind: value, title, icon: Icon }, index) => {
          const item = connections.find((entry) => entry.kind === value);
          return (
            <button
              key={value}
              type="button"
              className={kind === value ? 'active' : ''}
              aria-pressed={kind === value}
              disabled={busy}
              onClick={() => {
                setKind(value);
                setResourceId('primary');
                setShowSecret(false);
                setError(null);
                setMessage(null);
              }}
            >
              <span className="model-stage-icon">
                <Icon size={19} />
              </span>
              <span className="model-stage-copy">
                <strong>
                  <span>{index + 1}</span>
                  {t(title)}
                </strong>
                <small>{t(item?.configured && item.enabled ? '已配置' : '未启用')}</small>
              </span>
              {(resourceDrafts[value] ||
                Object.keys(drafts).some((key) => key.startsWith(`${value}:`))) && (
                <span className="model-draft-dot" title={t('尚未保存')} />
              )}
            </button>
          );
        })}
      </div>
      <div className="model-resource-selector" role="group" aria-label={t('接口资源')}>
        <button
          type="button"
          aria-pressed={resourceId === 'primary'}
          disabled={busy}
          onClick={() => chooseResource('primary')}
        >
          {t('首选资源')}
        </button>
        {resources.map((item, index) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={resourceId === item.id}
            disabled={busy}
            onClick={() => chooseResource(item.id)}
          >
            <span>{t('备用 {index}').replace('{index}', String(index + 1))}</span>
            {drafts[`${kind}:${item.id}`]?.name ?? item.name}
          </button>
        ))}
        {resources.length < 2 && (
          <Button variant="ghost" disabled={busy || !primary.configured} onClick={addResource}>
            <Plus size={14} />
            {t('添加备用资源')}
          </Button>
        )}
      </div>
      <p className="model-resource-policy">
        {t(
          '首选资源明确拒绝请求时，按顺序尝试已启用的备用资源。超时、结果未知或已受理的任务不会自动重复提交。',
        )}
      </p>
      {!primary.configured && <p className="field-hint">{t('先保存首选资源，再添加备用资源。')}</p>}
      <section className="panel model-connection-panel" aria-label={t(stage.title)}>
        <div className="model-connection-heading">
          <div>
            <h3>{t(stage.title)}</h3>
            <p>{t(stage.description)}</p>
          </div>
          <Badge tone={connection.configured && connection.enabled ? 'green' : 'neutral'}>
            {t(connection.configured && connection.enabled ? '已配置' : '未启用')}
          </Badge>
        </div>
        <form onSubmit={(event) => void save(event)}>
          <fieldset disabled={busy} className="model-connection-fields">
            {resourceId !== 'primary' && (
              <div className="model-resource-heading">
                <Field label={t('资源名称')}>
                  <input
                    required
                    maxLength={80}
                    value={draft.name}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </Field>
                <Button variant="ghost" onClick={removeResource}>
                  <Trash2 size={14} />
                  {t('移除备用资源')}
                </Button>
              </div>
            )}
            <Field
              label={t('服务地址')}
              hint={t(
                kind === 'video'
                  ? '填写完整视频任务地址，例如 https://站点/api/v3/contents/generations/tasks。'
                  : '填写接口基础地址，例如 https://站点/v1；保留中转站要求的路径。',
              )}
            >
              <input
                type="url"
                required
                maxLength={1000}
                value={draft.baseUrl}
                onChange={(event) => update({ baseUrl: event.target.value })}
                placeholder={
                  kind === 'video'
                    ? 'https://example.com/api/v3/contents/generations/tasks'
                    : 'https://example.com/v1'
                }
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
              />
            </Field>
            <div className="field">
              <label className="field-label" htmlFor={`${inputId}-secret`}>
                {t('API Key（接口密钥）')}
              </label>
              <div className="model-secret-input">
                <input
                  id={`${inputId}-secret`}
                  type={showSecret ? 'text' : 'password'}
                  maxLength={4096}
                  value={draft.secret}
                  onChange={(event) => update({ secret: event.target.value })}
                  autoComplete="new-password"
                  spellCheck={false}
                  disabled={draft.removeSecret}
                  placeholder={
                    connection.configured ? t('留空保留已保存密钥') : t('填写服务商提供的密钥')
                  }
                  aria-describedby={`${inputId}-secret-hint`}
                  dir="ltr"
                />
                <IconButton
                  label={t(showSecret ? '隐藏新输入的密钥' : '显示新输入的密钥')}
                  onClick={() => setShowSecret((old) => !old)}
                  disabled={!draft.secret || draft.removeSecret}
                  aria-pressed={showSecret}
                >
                  {showSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                </IconButton>
              </div>
              <span className="field-hint" id={`${inputId}-secret-hint`}>
                {connection.keyHint && (
                  <span>
                    {t('已保存密钥')}：{connection.keyHint}。{' '}
                  </span>
                )}
                {t('密钥加密保存在服务端，保存后不回显。')}{' '}
                {t('填写服务地址与密钥后将自动获取模型列表。')}
              </span>
              {connection.configured && (
                <label className="checkbox model-remove-secret">
                  <input
                    type="checkbox"
                    checked={draft.removeSecret}
                    onChange={(event) => update({ removeSecret: event.target.checked, secret: '' })}
                  />
                  {t('保存时移除此密钥')}
                </label>
              )}
            </div>
            {(directoryLoading || directoryError || directory.discoveryStatus === 'connected') && (
              <div
                className={`model-discovery-feedback ${directoryLoading ? 'is-loading' : directoryError ? 'is-error' : 'is-ready'}`}
                role={directoryError && !directoryLoading ? 'alert' : 'status'}
                aria-live="polite"
              >
                {directoryLoading ? (
                  <LoaderCircle size={17} className="model-discovery-spinner" />
                ) : directoryError ? (
                  <AlertCircle size={17} />
                ) : (
                  <Check size={17} />
                )}
                <div>
                  <strong>
                    {t(
                      directoryLoading
                        ? '正在获取模型列表…'
                        : directoryError
                          ? '模型列表获取失败'
                          : '已获取 {count} 个模型',
                    ).replace('{count}', String(models.length))}
                  </strong>
                  <span>
                    {t(
                      directoryLoading
                        ? '正在连接服务商，请稍候。'
                        : directoryError ||
                            (models.length
                              ? '点击模型输入框旁的箭头，可搜索并选择模型。'
                              : '服务商返回了空目录，可手动填写模型标识。'),
                    )}
                  </span>
                </div>
                {directoryError && !directoryLoading && (
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={!canDiscover || busy}
                    onClick={() => (preview.isDraft ? preview.retry() : void run('discover'))}
                  >
                    <RefreshCw size={14} />
                    {t('重试获取模型')}
                  </Button>
                )}
              </div>
            )}
            <div className="form-grid">
              <Field label={t('接口协议')}>
                {kind === 'image' ? (
                  <select
                    value={draft.protocol}
                    onChange={(event) =>
                      update({ protocol: event.target.value as ModelConnectionProtocol })
                    }
                  >
                    <option value="openai-images">{t(protocolNames['openai-images'])}</option>
                    <option value="seedream-images">{t(protocolNames['seedream-images'])}</option>
                  </select>
                ) : (
                  <input value={t(protocolNames[draft.protocol])} readOnly />
                )}
              </Field>
              <ModelPicker
                key={draftKey}
                label={t('模型标识')}
                hint={t('从目录选择或手动填写服务商提供的准确标识。')}
                required={draft.enabled}
                value={draft.model}
                onChange={selectModel}
                models={models}
                loading={directoryLoading}
                connected={directory.discoveryStatus === 'connected'}
              />
            </div>
            {kind === 'text' && (
              <ModelPicker
                label={t('视觉分析模型（可选）')}
                hint={t(
                  '参考复刻需要能读取图片的视觉模型。可从同一目录选择或手动填写，文本规划模型保持独立。',
                )}
                value={draft.visionModel}
                onChange={(visionModel) => update({ visionModel })}
                models={models}
                loading={directoryLoading}
                connected={directory.discoveryStatus === 'connected'}
                vision
              />
            )}
            {kind === 'video' && (
              <Field
                label={t('模型目录地址（可选）')}
                hint={t('填写与服务地址同一站点的完整目录地址；不提供目录时可手动填写模型。')}
              >
                <input
                  type="url"
                  maxLength={1000}
                  value={draft.modelsUrl}
                  onChange={(event) => update({ modelsUrl: event.target.value })}
                  placeholder="https://xingyunyinli.com/v1/models"
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                />
              </Field>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update({ enabled: event.target.checked })}
              />
              {t(resourceId === 'primary' ? '将此模型用于创作' : '启用此备用资源')}
            </label>
            {!draft.model.trim() && (
              <p className="field-hint">
                {t('填写地址与密钥后自动获取目录，选定模型后保存并启用。')}
              </p>
            )}
            <div className="model-connection-actions">
              <Button
                type="submit"
                name="action"
                value="discover"
                busy={busy}
                disabled={draft.removeSecret}
              >
                <Save size={15} />
                {t('保存并刷新模型')}
              </Button>
              <Button type="submit" name="action" value="save" variant="secondary" disabled={busy}>
                {t('仅保存配置')}
              </Button>
              {hasChanges && <span className="field-hint">{t('尚未保存')}</span>}
              {resources.length > 0 && (
                <span className="field-hint">{t('保存当前用途的首选及备用资源配置。')}</span>
              )}
            </div>
          </fieldset>
        </form>
        {message && (
          <p className="model-connection-message" role="status">
            <Check size={16} />
            {message}
          </p>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section
        className="panel model-directory"
        aria-label={t('模型目录')}
        aria-busy={directoryLoading}
      >
        <div className="model-connection-heading">
          <div>
            <h3>{t('模型目录')}</h3>
            <p>{t('目录仅列出服务商返回的模型；是否支持当前用途与生成效果需实际验证。')}</p>
          </div>
          <Button
            variant="ghost"
            busy={directoryLoading}
            disabled={!canDiscover || busy || directoryLoading}
            onClick={() => (preview.isDraft ? preview.retry() : void run('discover'))}
          >
            {!directoryLoading && <RefreshCw size={15} />}
            {t('刷新目录')}
          </Button>
        </div>
        {directoryLoading ? (
          <div className="model-directory-skeleton" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
        ) : models.length ? (
          <div className="model-directory-list">
            {models.map((model) => (
              <button
                key={model}
                type="button"
                className={draft.model === model ? 'selected' : ''}
                aria-pressed={draft.model === model}
                disabled={busy}
                onClick={() => selectModel(model)}
              >
                {draft.model === model && <Check size={13} />}
                <span>{model}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="model-directory-empty">{t('暂无模型目录，可先手动填写模型标识并保存。')}</p>
        )}
        <div className="model-directory-status">
          <Badge tone={directory.discoveryStatus === 'connected' ? 'green' : 'neutral'}>
            {t(
              directoryLoading
                ? '目录获取中'
                : directory.discoveryStatus === 'connected'
                  ? '目录已同步'
                  : directory.discoveryStatus === 'never'
                    ? '目录未查询'
                    : '目录未同步',
            )}
          </Badge>
          {!directoryLoading && directory.modelsCheckedAt && (
            <span>{dateTime(directory.modelsCheckedAt)}</span>
          )}
          {!directoryLoading && models.length > 0 && (
            <span>
              {models.length} {t('个模型')}
            </span>
          )}
        </div>
        {!directoryLoading && directory.discoveryMessage && (
          <p className="field-hint">{t(directory.discoveryMessage)}</p>
        )}
      </section>
      <p className="model-connections-note">
        {t('保存与刷新目录不会提交生成任务。实际模型费用由服务商收取。')}
      </p>
    </div>
  );
}
