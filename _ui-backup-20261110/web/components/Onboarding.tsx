import { useState } from 'react';
import { Image, Layers, FolderHeart, ArrowRight } from 'lucide-react';
import { useStudio } from '../context';
import { patch } from '../lib/api';
import { Button, Field, Modal, useAction } from './ui';
import { LANGUAGES, PLATFORMS } from '../../contracts/catalog';
import { t } from '../lib/i18n';
export function Onboarding() {
  const { session, refreshSession } = useStudio();
  const [platform, setPlatform] = useState(session?.user.preferences.defaultPlatform ?? '通用电商');
  const [language, setLanguage] = useState(
    session?.user.preferences.defaultCreationLanguage ?? 'zh-CN',
  );
  const action = useAction();
  const open = session?.user.preferences.onboardingCompleted === false;
  async function finish(skip = false) {
    await action.run(async () => {
      await patch('/auth/me', {
        preferences: {
          onboardingCompleted: true,
          ...(!skip ? { defaultPlatform: platform, defaultCreationLanguage: language } : {}),
        },
      });
      await refreshSession();
    });
  }
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!action.busy) void finish(true);
      }}
      title={t('欢迎来到映造')}
      description={t('为下一件作品，准备一个顺手的工作空间。')}
      wide
    >
      <div
        className="form-grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: 24 }}
      >
        {[
          {
            icon: <Image size={24} />,
            title: '从灵感开始',
            text: '写下需求，选择参考素材，为图片或视频保存创作草稿。',
          },
          {
            icon: <Layers size={24} />,
            title: '在画布里完善',
            text: '把素材、文字与生成结果自由组合。每一次保存都有版本。',
          },
          {
            icon: <FolderHeart size={24} />,
            title: '把作品整理好',
            text: '项目、品牌和素材统一管理，也能邀请伙伴进入团队。',
          },
        ].map((step) => (
          <div className="panel" style={{ padding: 20 }} key={step.title}>
            {step.icon}
            <h3>{t(step.title)}</h3>
            <p className="muted">{t(step.text)}</p>
          </div>
        ))}
      </div>
      <div className="form-grid">
        <Field label={t('默认发布平台')} hint={t('仅用于新建草稿，已有项目保持原有设置。')}>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('默认创作语言')} hint={t('用于画面文案，与界面语言分别设置。')}>
          <select value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
            {LANGUAGES.map((value) => (
              <option key={value.id} value={value.id}>
                {t(value.name)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="modal-actions">
        <Button variant="ghost" disabled={action.busy} onClick={() => void finish(true)}>
          {t('稍后设置')}
        </Button>
        <Button busy={action.busy} onClick={() => void finish()}>
          {t('开始我的创作')} <ArrowRight size={16} />
        </Button>
      </div>
    </Modal>
  );
}
