import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, type Locale } from '../src/web/lib/i18n';
import { productWarning } from '../src/web/lib/product-messages';

afterEach(() => setLocale('zh-CN'));

const warnings = [
  {
    input: '原模型当前不可选，已切换为 模型甲，请确认参数。',
    en: 'The original model is unavailable; changed to 模型甲. Review the settings.',
    ar: 'النموذج الأصلي غير متاح؛ جرى التبديل إلى 模型甲. راجع الإعدادات.',
  },
  {
    input: '当前模型不支持比例 21:9，已调整为 16:9。',
    en: 'This model does not support aspect ratio 21:9; changed to 16:9.',
    ar: 'هذا النموذج لا يدعم نسبة 21:9؛ جرى التعديل إلى 16:9.',
  },
  {
    input: '当前模型不支持清晰度 720p，已调整为 4K。',
    en: 'This model does not support resolution 720p; changed to 4K.',
    ar: 'هذا النموذج لا يدعم دقة 720p؛ جرى التعديل إلى 4K.',
  },
  {
    input: '当前模型不支持 17 秒，已调整为 5 秒。',
    en: 'This model does not support 17 seconds; changed to 5 seconds.',
    ar: 'هذا النموذج لا يدعم مدة 17 ثانية؛ جرى التعديل إلى 5 ثانية.',
  },
  {
    input: '保存的服务“自定义服务”当前不可用，请明确重新选择。',
    en: 'The saved service "自定义服务" is unavailable. Explicitly select another service.',
    ar: 'الخدمة المحفوظة «自定义服务» غير متاحة. اختر خدمة أخرى صراحةً.',
  },
  {
    input: '保存的模型“my-model-v9”当前不受支持，请明确重新选择。',
    en: 'The saved model "my-model-v9" is unsupported. Explicitly select another model.',
    ar: 'النموذج المحفوظ «my-model-v9» غير مدعوم. اختر نموذجًا آخر صراحةً.',
  },
  {
    input: '保存的时长“7.5秒”不受当前模型支持，原值已保留。',
    en: 'The saved duration of 7.5 seconds is unsupported. Its original value is retained.',
    ar: 'المدة المحفوظة البالغة 7.5 ثانية غير مدعومة. بقيت قيمتها الأصلية.',
  },
  {
    input: '保存的分辨率“720p”不受当前模型支持，原值已保留。',
    en: 'The saved resolution "720p" is unsupported. Its original value is retained.',
    ar: 'الدقة المحفوظة «720p» غير مدعومة. بقيت قيمتها الأصلية.',
  },
  {
    input: '保存的目标语言“zh-Hant”当前不受支持，原值已保留。',
    en: 'The saved target language "zh-Hant" is unsupported. Its original value is retained.',
    ar: 'اللغة الهدف المحفوظة «zh-Hant» غير مدعومة. بقيت قيمتها الأصلية.',
  },
  {
    input: '保存的放大倍数“3.25”当前不受支持，原值已保留。',
    en: 'The saved scale "3.25" is unsupported. Its original value is retained.',
    ar: 'معامل التكبير المحفوظ «3.25» غير مدعوم. بقيت قيمته الأصلية.',
  },
  {
    input: '方案比例“43:19”不在当前模型支持范围内；保留当前设置，请手动确认。',
    en: 'The plan’s aspect ratio "43:19" is unsupported. Current settings are retained; review them manually.',
    ar: 'نسبة الخطة «43:19» غير مدعومة. بقيت الإعدادات الحالية؛ راجعها يدويًا.',
  },
  {
    input: '方案分辨率“8K”不在当前模型支持范围内；保留当前设置，请手动确认。',
    en: 'The plan’s resolution "8K" is unsupported. Current settings are retained; review them manually.',
    ar: 'دقة الخطة «8K» غير مدعومة. بقيت الإعدادات الحالية؛ راجعها يدويًا.',
  },
  {
    input: '方案语言“用户的自定义语言”不在当前模型支持范围内；保留当前设置，请手动确认。',
    en: 'The plan’s language "用户的自定义语言" is unsupported. Current settings are retained; review them manually.',
    ar: 'لغة الخطة «用户的自定义语言» غير مدعومة. بقيت الإعدادات الحالية؛ راجعها يدويًا.',
  },
] as const;

for (const locale of ['en', 'ar'] as const) {
  describe(`${locale} product warning display`, () => {
    it.each(warnings)('formats $input without changing parameter values', ({ input, ...text }) => {
      setLocale(locale);
      expect(productWarning(input)).toBe(text[locale]);
    });

    it.each([
      {
        input:
          '已继承参考视频；请补充主体图片、检查动作片段，再确认人物与视频使用授权及外部费用。当前仅支持人物动作参考，不支持服装、人脸或商品精准替换。',
        en: 'The reference video is retained. Add a character image, review the motion clip, and confirm permission to use both media and the external cost. Only character motion reference is supported, without precise clothing, face or product replacement.',
        ar: 'بقي الفيديو المرجعي محفوظًا. أضف صورة الشخصية وراجع مقطع الحركة وأكّد إذن استخدام الوسيطين والتكلفة الخارجية. تُدعم مراجع حركة الشخصيات فقط، دون استبدال دقيق للملابس أو الوجه أو المنتج.',
      },
      {
        input: '参考视频超过30秒，当前预选前30秒；请在提交前检查并调整动作片段。',
        en: 'The reference video exceeds 30 seconds, so the first 30 seconds are initially selected. Review and adjust the motion clip before submitting.',
        ar: 'يتجاوز الفيديو المرجعي 30 ثانية، لذا تُحدَّد أول 30 ثانية مبدئيًا. راجع مقطع الحركة وعدّله قبل الإرسال.',
      },
    ])('translates an explicitly allowed fixed product warning: $input', ({ input, ...text }) => {
      setLocale(locale);
      expect(productWarning(input)).toBe(text[locale]);
    });

    it('does not reinterpret placeholders, Chinese copy or HTML inside the old resolution', () => {
      setLocale(locale);
      const value = '{next} / 固定期会员 / <b data-x="{value}">中文</b> / $&';
      const message = `当前模型不支持清晰度 ${value}，已调整为 4K。`;
      expect(productWarning(message)).toBe(
        locale === 'en'
          ? `This model does not support resolution ${value}; changed to 4K.`
          : `هذا النموذج لا يدعم دقة ${value}؛ جرى التعديل إلى 4K.`,
      );
    });

    it('does not reinterpret a placeholder-containing replacement value', () => {
      setLocale(locale);
      const next = '{value}{next}<img src=x onerror="throw 1">原值$&';
      const message = `当前模型不支持清晰度 720p，已调整为 ${next}。`;
      expect(productWarning(message)).toBe(
        locale === 'en'
          ? `This model does not support resolution 720p; changed to ${next}.`
          : `هذا النموذج لا يدعم دقة 720p؛ جرى التعديل إلى ${next}.`,
      );
    });

    it.each([
      '',
      '固定期会员',
      '用户备注：当前模型不支持清晰度 720p，已调整为 4K。',
      '当前模型不支持清晰度 720p，已调整为 4K。用户追加说明',
      '保存的模型“未知”当前不受支持，用户要求照常保留。',
      '<p>用户中文 {next} / English / العربية</p>',
      '  用户换行\n原始内容 {value}\t',
    ])('leaves unknown user content unchanged: %j', (message) => {
      setLocale(locale);
      expect(productWarning(message)).toBe(message);
    });
  });
}

it('reads the active locale on each call after the module has already loaded', () => {
  const message = warnings[2];
  for (const locale of ['en', 'ar', 'zh-CN', 'en'] satisfies Locale[]) {
    setLocale(locale);
    expect(productWarning(message.input)).toBe(
      locale === 'zh-CN' ? message.input : message[locale],
    );
  }
});

it('starts with the default locale after prior tests clean up their locale state', () => {
  expect(getLocale()).toBe('zh-CN');
  for (const { input } of warnings) expect(productWarning(input)).toBe(input);
});
