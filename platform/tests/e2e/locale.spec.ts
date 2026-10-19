import { join } from 'node:path';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false });

for (const language of [
  {
    id: 'en',
    direction: 'ltr',
    phone: 'Phone and WeChat sign-in',
    password: 'Local password',
    faq: 'How do I start my first creation?',
    faqBody: 'Enter a brief in Inspiration',
    recovery: 'Forgot password',
    registration: 'Complete account registration',
  },
  {
    id: 'ar',
    direction: 'rtl',
    phone: 'تسجيل الدخول بالهاتف وWeChat',
    password: 'كلمة مرور محلية',
    faq: 'كيف أبدأ أول عمل؟',
    faqBody: 'اكتب طلبك في صفحة الإلهام',
    recovery: 'نسيت كلمة المرور',
    registration: 'إكمال تسجيل الحساب',
  },
] as const) {
  test(`persists ${language.id} interface language while keeping creation language separate and translating account and help pages`, async ({
    page,
    studio,
  }) => {
    const account = await studio.existingIdentitySession();
    await page.context().addCookies([
      {
        name: 'studio_session',
        value: account.sessionToken,
        url: studio.origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto(`${studio.origin}/settings`);
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption(language.id);
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', language.id);
    await expect(page.locator('html')).toHaveAttribute('dir', language.direction);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', language.id);
    await expect.soft(page.getByRole('heading')).toContainText([language.password, language.phone]);
    const preferences = (await (await page.request.get(`${studio.origin}/api/v1/auth/me`)).json())
      .data.user.preferences;
    expect(preferences.locale).toBe(language.id);
    expect(preferences.defaultCreationLanguage).toBe('zh-CN');
    await page.goto(`${studio.origin}/support`);
    const faq = page.locator('.faq');
    await expect(faq).toBeVisible();
    expect.soft(await faq.getByRole('button').allTextContents()).toContain(language.faq);
    expect.soft(await faq.locator('p').innerText()).toContain(language.faqBody);
    await page.screenshot({
      path: join(studio.folder, `support-${language.id}.png`),
      fullPage: true,
    });
    await page.goto(`${studio.origin}/password/forgot`);
    expect.soft(await page.getByRole('heading', { level: 1 }).innerText()).toBe(language.recovery);
    await page.goto(`${studio.origin}/auth/complete-registration`);
    expect
      .soft(await page.getByRole('heading', { level: 1 }).innerText())
      .toBe(language.registration);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: join(studio.folder, `identity-registration-${language.id}.png`),
      fullPage: true,
    });
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
    expect(
      studio.services.db.sqlite.prepare('SELECT count(*) n FROM sms_deliveries').get(),
    ).toEqual({ n: 0 });
  });
}
