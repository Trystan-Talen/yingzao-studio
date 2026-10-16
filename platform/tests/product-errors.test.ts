import { afterEach, expect, it } from 'vitest';
import { ApiError, errorMessage } from '../src/web/lib/api';
import { setLocale } from '../src/web/lib/i18n';

afterEach(() => setLocale('zh-CN'));
for (const value of [
  {
    code: 'ENTITLEMENT_LIMIT',
    source: '已达到对应合同的品牌数量上限',
    en: 'The brand limit for the applicable contract has been reached.',
    ar: 'تم بلوغ حد العلامات التجارية للعقد المعمول به.',
  },
  {
    code: 'BRAND_QUOTA_INVALID',
    source: '品牌配额合同无效，请核对套餐配置',
    en: 'The brand quota contract is invalid. Check the plan configuration.',
    ar: 'عقد حصة العلامات التجارية غير صالح. تحقّق من إعدادات الباقة.',
  },
]) {
  for (const locale of ['zh-CN', 'en', 'ar'] as const)
    it(`localizes only the known ${value.code} in ${locale}`, () => {
      setLocale(locale);
      expect(errorMessage(new ApiError(value.code, value.source, 409))).toBe(
        locale === 'zh-CN' ? value.source : value[locale],
      );
    });
}
it('preserves unknown, provider and user-authored messages even when text resembles a known error', () => {
  setLocale('ar');
  const source = '已达到对应合同的品牌数量上限';
  expect(errorMessage(new ApiError('PROVIDER_ERROR', source, 502))).toBe(source);
  expect(errorMessage(new Error(source))).toBe(source);
  const unknown = '用户正文 {value} <b>保留</b>：已达到对应合同的品牌数量上限';
  expect(errorMessage(new ApiError('ENTITLEMENT_LIMIT', unknown, 409))).toBe(unknown);
});
