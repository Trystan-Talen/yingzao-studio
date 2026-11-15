import type { ReferenceStudyResult } from '../../contracts/reference-study';
import type { CreativeAnswer, CreativePreparation } from '../../contracts/creative-intent';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, CheckCircle2, HelpCircle, LoaderCircle } from 'lucide-react';
import { t } from '../lib/i18n';
import { dateTime } from '../lib/api';
import { Button, Notice } from './ui';
import '../styles/creative-brief.css';

export function CreativeContextSources({ preparation }: { preparation: CreativePreparation }) {
  if (!(preparation.contextSources?.length || preparation.omittedMemoryCount)) return null;
  return (
    <details className="knowledge-sources">
      <summary>{t('本次采用的资料')}</summary>
      <p className="field-hint">{t('以下为本次规划的资料快照；后续编辑不改变已确认方案。')}</p>
      {preparation.contextSources?.map((source) => (
        <div className="knowledge-source" key={`${source.kind}:${source.id}`}>
          <strong>
            {t(source.kind === 'brand' ? '品牌' : source.kind === 'product' ? '产品' : '创作记忆')}{' '}
            · {source.label}
          </strong>
          <p className="field-hint">
            {source.version !== undefined ? `${t('版本')} ${source.version} · ` : ''}
            {dateTime(source.updatedAt)}
          </p>
          {source.expiresAt && (
            <p className="field-hint">
              {t('当时有效至')}：{dateTime(source.expiresAt)}
            </p>
          )}
          <p>{source.content}</p>
        </div>
      ))}
      {!!preparation.omittedMemoryCount && (
        <p className="field-hint">
          {t('本次未采用的记忆')}：{preparation.omittedMemoryCount} ·{' '}
          {t('仅取适用且有效的有限资料，避免无关信息干扰。')}
        </p>
      )}
    </details>
  );
}

export function CreativeSummary({
  summary,
  assumptions,
}: {
  summary: string;
  assumptions: string[];
}) {
  return (
    <div className="creative-summary">
      <p className="creative-brief-summary">
        <strong>{t('创作理解')}：</strong>
        {summary}
      </p>
      {!!assumptions.length && (
        <details>
          <summary>{t('本次采用的默认建议')}</summary>
          <ul>
            {assumptions.map((assumption, index) => (
              <li key={index}>{assumption}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ReferenceStudyPreview({
  value,
  preparation,
}: {
  value: ReferenceStudyResult;
  preparation: CreativePreparation;
}) {
  const { study, evidence } = value;
  return (
    <section className="creative-generation-plan" aria-label={t('参考复刻方案')}>
      <h4>{t('参考要点')}</h4>
      <ul>
        {study.observations.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
      {study.referenceKind === 'video' && (
        <>
          <p className="field-hint">
            {t('参考区间')}：{evidence.clipStartSeconds.toFixed(1)} –{' '}
            {(evidence.clipStartSeconds + evidence.clipDurationSeconds).toFixed(1)} {t('秒')}
          </p>
          <p className="field-hint">
            {t('根据抽帧分析迁移运镜与节奏，不直接传整段视频；未分析音轨，不保证逐帧复制。')}
          </p>
          <details>
            <summary>{t('采样画面与运动判断')}</summary>
            <ol>
              {study.timeline.map((entry, index) => (
                <li key={index}>
                  {entry.timestampSeconds.toFixed(1)} {t('秒')} · {entry.description}
                </li>
              ))}
            </ol>
            <p>{study.motion?.description}</p>
            <ul>
              {study.motion?.uncertainties.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </details>
        </>
      )}
      <h4>{t('主体与场景转化方案')}</h4>
      <p>{study.transferGuidance}</p>
      <h4>{t('本次参考的局限')}</h4>
      <ul>
        {study.limitations.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
      <details>
        <summary>{t('查看生成方案')}</summary>
        {preparation.result.generationPlan ? (
          <>
            <h4>{t('首帧画面')}</h4>
            <p>{preparation.result.generationPlan.imagePrompt}</p>
            <h4>{t('镜头与动作')}</h4>
            <p>{preparation.result.generationPlan.videoPrompt}</p>
          </>
        ) : (
          <p>{preparation.result.prompt}</p>
        )}
      </details>
    </section>
  );
}

export function CreativeBrief({
  preparation,
  answers,
  busy,
  locked,
  error,
  canRestart,
  onRestart,
  canRefreshSources = false,
  onRefreshSources,
  onAnswer,
  missingQuestionId,
  focusRequest = 0,
  onAddReference,
  onEditSettings,
}: {
  preparation?: CreativePreparation;
  answers: CreativeAnswer[];
  busy: boolean;
  locked: boolean;
  error?: string;
  canRestart: boolean;
  onRestart: () => void;
  canRefreshSources?: boolean;
  onRefreshSources?: () => void;
  onAnswer: (questionId: string, answer: string) => void;
  mediaType: 'image' | 'video';
  missingQuestionId?: string;
  focusRequest?: number;
  onAddReference?: () => void;
  onEditSettings?: () => void;
}) {
  const section = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (preparation?.status === 'needs_clarification' && !busy) title.current?.focus();
  }, [preparation?.id, busy]);
  useEffect(() => {
    if (!missingQuestionId || !focusRequest || busy) return;
    const field = Array.from(section.current?.querySelectorAll('fieldset') ?? []).find(
      (element) => element.dataset.questionId === missingQuestionId,
    );
    const control =
      field?.querySelector<HTMLTextAreaElement>('textarea') ??
      field?.querySelector<HTMLElement>('[data-answer-control]');
    control?.focus();
    field?.scrollIntoView({ block: 'nearest' });
  }, [missingQuestionId, focusRequest, busy]);
  if (!preparation && !busy && !error) return null;
  const clarifying = preparation?.status === 'needs_clarification';
  return (
    <section
      ref={section}
      className={`creative-brief studio-creative-brief${clarifying ? ' creative-brief-questions' : ''}`}
      aria-label={t('创作需求检查')}
      aria-busy={busy}
    >
      {busy && (
        <p className="studio-brief-progress" role="status">
          <LoaderCircle size={17} aria-hidden="true" />
          {t('正在整理你的想法…')}
        </p>
      )}
      {error && (
        <Notice tone="warning">
          <strong>{t('这次理解还没完成')}</strong>
          <p>
            {t(
              canRestart
                ? '内容已保留。重新检查后，点击下方按钮继续。'
                : locked
                  ? '结果尚未确认。点击下方按钮核对同一次请求。'
                  : '内容已保留。点击下方按钮重试。',
            )}
          </p>
          <details>
            <summary>{t('查看详细信息')}</summary>
            <p>{error}</p>
          </details>
          {canRestart && (
            <Button variant="secondary" disabled={busy} onClick={onRestart}>
              {t('重新检查')}
            </Button>
          )}
        </Notice>
      )}
      {preparation && <CreativeContextSources preparation={preparation} />}
      {preparation?.status === 'ready' && onRefreshSources && (
        <div>
          <Button
            variant="secondary"
            disabled={!canRefreshSources || busy || locked}
            onClick={onRefreshSources}
          >
            {t('按最新资料重新整理')}
          </Button>
          <p className="field-hint">
            {t(
              '取消当前待确认报价，保留已保存的方案和已提交任务。再次点击生成才会读取最新资料并重新整理，可能产生策划费用。',
            )}
          </p>
          <p className="field-hint">
            {t('原始需求与素材选择不变；旧方案的补充回答需要重新确认。')}
          </p>
        </div>
      )}
      {preparation?.status === 'ready' && (
        <details className="creative-brief-ready">
          <summary>
            <CheckCircle2 size={17} aria-hidden="true" />
            {t('需求已整理，查看详情')}
          </summary>
          <CreativeSummary
            summary={preparation.result.summary}
            assumptions={preparation.result.assumptions}
          />
          {preparation.referenceStudy && (
            <ReferenceStudyPreview value={preparation.referenceStudy} preparation={preparation} />
          )}
          {!preparation.referenceStudy && preparation.result.generationPlan && (
            <div className="creative-generation-plan">
              <h4>{t('首帧画面')}</h4>
              <p>{preparation.result.generationPlan.imagePrompt}</p>
              <h4>{t('镜头与动作')}</h4>
              <p>{preparation.result.generationPlan.videoPrompt}</p>
            </div>
          )}
        </details>
      )}
      {clarifying && (
        <>
          <div className="studio-brief-heading">
            <HelpCircle size={20} aria-hidden="true" />
            <div>
              <h3 className="creative-brief-title" ref={title} tabIndex={-1}>
                {t(preparation.result.questions.length === 1 ? '确认这一点' : '确认这两点')}
              </h3>
              <p>{t('选好或填好答案，再点击继续。')}</p>
            </div>
          </div>
          {preparation.result.questions.map((question, index) => {
            const value = answers.find((answer) => answer.questionId === question.id)?.answer ?? '';
            return (
              <CreativeQuestion
                key={`${preparation.id}:${question.id}`}
                question={question}
                number={preparation.result.questions.length > 1 ? index + 1 : undefined}
                value={value}
                locked={locked}
                missing={missingQuestionId === question.id}
                onAnswer={onAnswer}
                onAddReference={onAddReference}
                onEditSettings={onEditSettings}
              />
            );
          })}
        </>
      )}
    </section>
  );
}

function CreativeQuestion({
  question,
  number,
  value,
  locked,
  missing,
  onAnswer,
  onAddReference,
  onEditSettings,
}: {
  question: CreativePreparation['result']['questions'][number];
  number?: number;
  value: string;
  locked: boolean;
  missing: boolean;
  onAnswer: (questionId: string, answer: string) => void;
  onAddReference?: () => void;
  onEditSettings?: () => void;
}) {
  const [writing, setWriting] = useState(false);
  const custom =
    writing || !question.options.length || (!!value && !question.options.includes(value));
  const textarea = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const errorId = useId();
  useEffect(() => {
    if (writing) textarea.current?.focus();
  }, [writing]);
  return (
    <fieldset
      data-question-id={question.id}
      disabled={locked}
      className={missing ? 'creative-question-missing' : undefined}
    >
      <legend>
        {number && (
          <span className="studio-question-number" aria-hidden="true">
            {number}
          </span>
        )}
        <span>{question.question}</span>
      </legend>
      {!!question.options.length && (
        <div className="creative-brief-options">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              className="studio-question-option"
              data-answer-control
              aria-pressed={value === option}
              aria-describedby={missing ? errorId : undefined}
              onClick={() => {
                setWriting(false);
                onAnswer(question.id, option);
              }}
            >
              <span className="studio-question-option-mark" aria-hidden="true">
                {value === option && <Check size={13} />}
              </span>
              <span>{option}</span>
            </button>
          ))}
          <button
            type="button"
            className="text-button creative-custom-answer"
            aria-expanded={custom}
            aria-controls={custom ? inputId : undefined}
            onClick={() => {
              setWriting(true);
              if (question.options.includes(value)) onAnswer(question.id, '');
            }}
          >
            {t('自己填写')}
          </button>
        </div>
      )}
      {custom && (
        <textarea
          ref={textarea}
          id={inputId}
          data-answer-control
          aria-label={question.question}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? errorId : undefined}
          value={value}
          maxLength={2000}
          rows={2}
          placeholder={t('写下你的答案')}
          onChange={(event) => onAnswer(question.id, event.target.value)}
        />
      )}
      {missing && (
        <p className="creative-question-error" id={errorId} role="alert">
          {t('请先回答这一题。')}
        </p>
      )}
      {question.field === 'reference' && onAddReference && (
        <button type="button" className="text-button" onClick={onAddReference}>
          {t('添加参考图')}
        </button>
      )}
      {['capability', 'conflict'].includes(question.field) && onEditSettings && (
        <button type="button" className="text-button" onClick={onEditSettings}>
          {t('修改相关设置')}
        </button>
      )}
      {question.reason && (
        <details className="creative-question-reason">
          <summary>{t('为什么需要确认？')}</summary>
          <p>{question.reason}</p>
        </details>
      )}
    </fieldset>
  );
}
