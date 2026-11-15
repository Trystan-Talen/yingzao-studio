import { useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Eye, EyeOff, Image, KeyRound, RefreshCw, Save, Text, Video } from 'lucide-react';
import type {
  ModelConnectionDto,
  ModelConnectionKind,
  ModelConnectionProtocol,
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
  const [drafts, setDrafts] = useState<Partial<Record<ModelConnectionKind, Draft>>>({});
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestActive = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  const inputId = useId();
  const connection = connections.find((item) => item.kind === kind);
  if (!connection) return <ErrorState error={new Error(t('模型配置不完整，请刷新页面。'))} />;
  const draft = drafts[kind] ?? makeDraft(connection);
  const stage = stages.find((item) => item.kind === kind)!;
  const models = connection.models;
  const canDiscover = connection.configured && !!connection.baseUrl;
  const hasChanges = !!drafts[kind];

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
    setDrafts((old) => ({ ...old, [kind]: { ...draft, ...change } }));
    setError(null);
    setMessage(null);
  }
  function selectModel(model: string) {
    update({
      model,
      ...(kind === 'image' && isKnownSeedreamModel(model) ? { protocol: 'seedream-images' } : {}),
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    await run(submitter?.getAttribute('value') === 'discover' ? 'save-discover' : 'save');
  }

  async function run(mode: 'save' | 'save-discover' | 'discover') {
    if (requestActive.current || !connection) return;
    requestActive.current = true;
    setBusy(true);
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
              protocol: draft.protocol,
              baseUrl: draft.baseUrl.trim(),
              modelsUrl: draft.modelsUrl.trim(),
              model: draft.model.trim(),
              ...(kind === 'text' ? { visionModel: draft.visionModel.trim() } : {}),
              enabled: draft.enabled,
              ...(draft.secret.trim() ? { secret: draft.secret.trim() } : {}),
              ...(draft.removeSecret ? { removeSecret: true } : {}),
            }),
          },
          workspaceId,
        );
        acceptConnection(result);
        saved = true;
        setDrafts((old) => {
          const next = { ...old };
          delete next[kind];
          return next;
        });
        setShowSecret(false);
      }
      if (mode !== 'save') {
        const result = await api<ModelConnectionDto>(
          `/model-connections/${kind}/models`,
          { method: 'POST' },
          workspaceId,
        );
        acceptConnection(result);
        setMessage(
          result.discoveryStatus === 'connected'
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
    }
  }

  return (
    <div className="model-connections section-spaced">
      <div className="model-connections-intro">
        <h2>{t('连接创作模型')}</h2>
        <p>{t('分别连接文本、图片和视频服务，可使用同一中转站，也可独立配置。')}</p>
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
              {drafts[value] && <span className="model-draft-dot" title={t('尚未保存')} />}
            </button>
          );
        })}
      </div>
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
                {t('密钥加密保存在服务端，保存后不回显。')}
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
              <Field label={t('模型标识')} hint={t('从目录选择或手动填写服务商提供的准确标识。')}>
                <input
                  list={`${inputId}-models`}
                  required={draft.enabled}
                  maxLength={120}
                  value={draft.model}
                  onChange={(event) => selectModel(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                />
                <datalist id={`${inputId}-models`}>
                  {models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </Field>
            </div>
            {kind === 'text' && (
              <Field
                label={t('视觉分析模型（可选）')}
                hint={t(
                  '参考复刻需要能读取图片的视觉模型。可从同一目录选择或手动填写，文本规划模型保持独立。',
                )}
              >
                <input
                  list={`${inputId}-models`}
                  maxLength={120}
                  value={draft.visionModel}
                  onChange={(event) => update({ visionModel: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                />
              </Field>
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
              {t('将此模型用于创作')}
            </label>
            {!draft.model.trim() && (
              <p className="field-hint">
                {t('尚不清楚模型标识时，可先保存并刷新目录，选定模型后再启用。')}
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
      <section className="panel model-directory" aria-label={t('模型目录')}>
        <div className="model-connection-heading">
          <div>
            <h3>{t('模型目录')}</h3>
            <p>{t('目录仅列出服务商返回的模型；是否支持当前用途与生成效果需实际验证。')}</p>
          </div>
          <Button
            variant="ghost"
            busy={busy}
            disabled={!canDiscover || hasChanges}
            onClick={() => void run('discover')}
          >
            <RefreshCw size={15} />
            {t('刷新目录')}
          </Button>
        </div>
        {models.length ? (
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
          <Badge tone={connection.discoveryStatus === 'connected' ? 'green' : 'neutral'}>
            {t(
              connection.discoveryStatus === 'connected'
                ? '目录已同步'
                : connection.discoveryStatus === 'never'
                  ? '目录未查询'
                  : '目录未同步',
            )}
          </Badge>
          {connection.modelsCheckedAt && <span>{dateTime(connection.modelsCheckedAt)}</span>}
          {models.length > 0 && (
            <span>
              {models.length} {t('个模型')}
            </span>
          )}
        </div>
        {connection.discoveryMessage && <p className="field-hint">{connection.discoveryMessage}</p>}
      </section>
      <p className="model-connections-note">
        {t('保存与刷新目录不会提交生成任务。实际模型费用由服务商收取。')}
      </p>
    </div>
  );
}
