import { t } from '../lib/i18n';
import { useId, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { designPlanSchema, formatDesignPlan, type DesignPlan } from '../../contracts/design-plan';
import { Badge, Button, Field, Notice, useAction } from './ui';

export function DesignPlanResult({
  plan,
  onApply,
}: {
  plan: DesignPlan;
  onApply?: (plan: DesignPlan, direction: number) => void;
}) {
  const [draft, setDraft] = useState(plan);
  const [selected, setSelected] = useState(0);
  const groupId = useId();
  const action = useAction();
  const valid = designPlanSchema.safeParse(draft);
  function patch(key: 'objective' | 'style' | 'composition' | 'scene', value: string) {
    setDraft((p) => ({ ...p, [key]: value }));
  }
  return (
    <section className="plan-result" aria-label={t('结构化设计方案')}>
      <div className="section-heading">
        <h3>{t('设计方案')}</h3>
        <Badge tone="green">{t('原始方案已保存')}</Badge>
      </div>
      <p className="muted">
        {t('选择一个方向并核对需求。应用后保存到当前创作草稿；原始方案保留在任务中。')}
      </p>
      <Notice>{draft.analysis}</Notice>
      <div className="form-grid">
        {(
          [
            ['objective', '创作目标'],
            ['style', '视觉风格'],
            ['composition', '构图与版式'],
            ['scene', '场景'],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={t(label)}>
            <textarea
              rows={2}
              maxLength={2000}
              value={draft[key]}
              onChange={(e) => patch(key, e.target.value)}
            />
          </Field>
        ))}
        <Field label={t('配色（每行一种）')}>
          <textarea
            rows={2}
            value={draft.palette.join('\n')}
            maxLength={1211}
            onChange={(e) => setDraft({ ...draft, palette: e.target.value.split('\n') })}
          />
        </Field>
        <Field label={t('文案（每行一句，可留空）')}>
          <textarea
            rows={2}
            value={draft.copy.join('\n')}
            maxLength={6011}
            onChange={(e) =>
              setDraft({ ...draft, copy: e.target.value ? e.target.value.split('\n') : [] })
            }
          />
        </Field>
      </div>
      <div className="plan-technical">
        {(
          [
            ['ratio', '建议比例'],
            ['resolution', '建议分辨率'],
            ['language', '建议语言'],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={t(label)}>
            <input
              value={draft.technical[key]}
              maxLength={key === 'language' ? 80 : 40}
              onChange={(e) =>
                setDraft({ ...draft, technical: { ...draft.technical, [key]: e.target.value } })
              }
            />
          </Field>
        ))}
      </div>
      <fieldset className="plan-directions">
        <legend>{t('选择一个创作方向')}</legend>
        {draft.directions.map((d, index) => (
          <article key={index} className={`plan-direction ${selected === index ? 'selected' : ''}`}>
            <label className="plan-choice">
              <input
                type="radio"
                name={groupId}
                checked={selected === index}
                onChange={() => setSelected(index)}
              />
              {t('方向')} {index + 1}
            </label>
            <Field label={t('方向 {n} 标题').replace('{n}', String(index + 1))}>
              <input
                maxLength={80}
                value={d.title}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    directions: draft.directions.map((v, i) =>
                      i === index ? { ...v, title: e.target.value } : v,
                    ),
                  })
                }
              />
            </Field>
            <Field label={t('方向 {n} 画面要求').replace('{n}', String(index + 1))}>
              <textarea
                rows={3}
                maxLength={2000}
                value={d.prompt}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    directions: draft.directions.map((v, i) =>
                      i === index ? { ...v, prompt: e.target.value } : v,
                    ),
                  })
                }
              />
            </Field>
          </article>
        ))}
      </fieldset>
      {!valid.success && (
        <Notice tone="warning">
          {t('请填写完整方案、最多 12 种配色及 12 句文案；空白行请删除。')}
        </Notice>
      )}
      <div className="inline-actions">
        <Button
          variant="secondary"
          disabled={!valid.success}
          onClick={() =>
            void action.run(
              () => navigator.clipboard.writeText(formatDesignPlan(draft)),
              '方案已复制',
            )
          }
        >
          <Copy size={15} />
          {t('复制完整方案')}
        </Button>
        {onApply && (
          <Button
            disabled={!valid.success}
            onClick={() =>
              void action.run(async () => {
                onApply(draft, selected);
              })
            }
          >
            <Check size={15} />
            {t('应用方向')} {selected + 1} {t('到创作')}
          </Button>
        )}
      </div>
    </section>
  );
}
