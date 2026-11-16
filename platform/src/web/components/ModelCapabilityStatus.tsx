import { LoaderCircle } from 'lucide-react';
import { capabilityParameterLabels, type ModelCapabilityState } from '../lib/use-model-capability';
import { dateTime } from '../lib/api';
import { t } from '../lib/i18n';
import { Button, Notice } from './ui';

export function ModelCapabilityStatus({
  capability,
  selectionIssue,
  onUseFixed,
}: {
  capability: ModelCapabilityState;
  selectionIssue?: string | null;
  onUseFixed?: () => void;
}) {
  const { data, error, isFetching, isExpired, canGenerate } = capability;
  const needsConnection = data?.reasonCode === 'NOT_CONFIGURED';
  const documented = data?.source === 'provider-documentation';
  const configuredPipeline = data?.providerId === 'native' && data.source === 'local-adapter';
  const blocking = Boolean(
    isFetching || error || isExpired || selectionIssue || (data && !canGenerate),
  );
  const summary = isFetching
    ? '正在核查当前模型…'
    : error
      ? '模型信息未能更新，请重试后再生成。'
      : needsConnection
        ? data.reason || '请在设置中连接服务'
        : isExpired
          ? '模型信息已过期，请刷新后再生成。'
          : !data
            ? '请先选择可用的服务和模型。'
            : !canGenerate
              ? data.reason || '当前模型暂不可用，请刷新或更换模型。'
              : configuredPipeline
                ? '编排配置已就绪；使用当前协议支持的参数，尚未验证远端生成。'
                : documented
                  ? '模型可用性已实时核查；参数范围来自已核对的原厂文档。'
                  : data.parametersVerified
                    ? '可查询的模型参数已更新'
                    : '当前接入未取得完整参数结构，使用已接入的选项。';
  return (
    <div
      className="model-capability-status"
      data-blocking={blocking}
      aria-live="polite"
      aria-busy={isFetching || undefined}
    >
      <details>
        <summary className="field-hint">
          {isFetching && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
          {t(
            canGenerate && !isExpired && !error && !isFetching
              ? configuredPipeline
                ? '配置已就绪 · 查看生成链路'
                : documented
                  ? '参数已补齐 · 查看文档来源'
                  : data?.parametersVerified
                    ? '参数已更新 · 查看来源'
                    : '模型可用 · 使用已接入参数'
              : summary,
          )}
        </summary>
        <div className="field-hint">
          <p>{t(summary)}</p>
          {data && (
            <>
              <p>
                {t('信息来源')}：
                {t(
                  {
                    'upstream-schema': '服务提供的参数',
                    'upstream-model-list': '服务提供的模型列表',
                    'provider-documentation': '原厂文档与当前接入',
                    'local-adapter': '当前接入设置',
                    none: '暂未取得模型信息',
                  }[data.source],
                )}
              </p>
              <p>
                {t('核查时间')}：{dateTime(data.checkedAt)}
              </p>
              {data.documentation?.map((document) => (
                <p key={document.url}>
                  <a href={document.url} target="_blank" rel="noreferrer">
                    {t('参数依据文档')}
                  </a>
                  {' · '}
                  {t('文档核对日期')}：{document.reviewedAt}
                </p>
              ))}
              {data.catalog && (
                <p>
                  {t(
                    data.catalog.status === 'available'
                      ? '服务商目录已同步；计费档位不作为生成参数范围。'
                      : '服务商目录暂未同步；已保留文档参数范围。',
                  )}
                </p>
              )}
              {documented && data.modelId === 'doubao-seedream-5.0-lite' && (
                <p>{t('此模型通过尺寸控制清晰度，没有独立的低、中、高画质选项。')}</p>
              )}
              <dl className="capability-parameter-list">
                {data.parameters.map((parameter) => (
                  <div key={parameter.key}>
                    <dt>{t(capabilityParameterLabels[parameter.key])}</dt>
                    <dd>
                      <span>{parameter.values.map(String).join(' / ') || '—'}</span>
                      <small>
                        {t(
                          parameter.source === 'upstream-schema'
                            ? '服务提供的参数'
                            : parameter.source === 'provider-documentation'
                              ? '原厂文档与当前接入'
                              : '当前接入设置',
                        )}
                        {parameter.key === 'size'
                          ? ` · ${t('随比例与清晰度确定')}`
                          : !parameter.adjustable
                            ? ` · ${t('由当前服务固定')}`
                            : ''}
                      </small>
                    </dd>
                  </div>
                ))}
              </dl>
              {!data.parametersVerified && !documented && (
                <p>{t('当前已核实接口未返回完整参数结构，不能确认上游的全部可选项。')}</p>
              )}
            </>
          )}
          <p>{t('核查模型信息不生成内容，也不代表已验证生成质量。')}</p>
          <Button
            variant="ghost"
            busy={isFetching}
            disabled={!capability.canRefresh}
            onClick={() => void capability.refresh()}
          >
            {t('刷新模型信息')}
          </Button>
        </div>
      </details>
      {selectionIssue && (
        <Notice tone="warning">
          {selectionIssue}
          {onUseFixed && Object.keys(capability.fixedOptions).length > 0 && (
            <Button variant="ghost" onClick={onUseFixed}>
              {t('采用当前模型的固定参数')}
            </Button>
          )}
        </Notice>
      )}
      {!needsConnection && !isFetching && (error || isExpired || (data && !canGenerate)) && (
        <div className="inline-actions">
          <Button
            variant="ghost"
            disabled={!capability.canRefresh}
            onClick={() => void capability.refresh()}
          >
            {t('重试核查')}
          </Button>
        </div>
      )}
    </div>
  );
}
