import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

test.use({ reducedMotion: 'reduce' });

for (const theme of ['dark', 'light'] as const) {
  test(`home placeholder and explanatory text remain readable in ${theme} theme`, async ({
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
    await page.goto(studio.origin);
    await page.getByRole('textbox', { name: '创作需求', exact: true }).waitFor();
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    const measurements = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      const rgba = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const values = [...context.getImageData(0, 0, 1, 1).data];
        return [values[0]!, values[1]!, values[2]!, values[3]! / 255];
      };
      const blend = (front: number[], back: number[]) =>
        front
          .slice(0, 3)
          .map((channel, index) => channel * front[3]! + back[index]! * (1 - front[3]!));
      const luminance = (rgb: number[]) =>
        rgb.reduce((sum, channel, index) => {
          const value = channel / 255;
          return (
            sum +
            (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
              [0.2126, 0.7152, 0.0722][index]!
          );
        }, 0);
      const selectors = [
        ['.yz-create textarea.prompt-input', '::placeholder'],
        ['.yz-result-hint', ''],
        ['.credit-estimate-note', ''],
        ['.composer-note', ''],
        ['.yz-capability-text small', ''],
        ['.yz-note', ''],
      ];
      return selectors.flatMap(([selector, pseudo]) =>
        [...document.querySelectorAll<HTMLElement>(selector!)]
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => {
            const style = getComputedStyle(element, pseudo || null);
            const ancestors: { selector: string; color: string; opacity: number; image: string }[] =
              [];
            for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
              const current = getComputedStyle(parent);
              ancestors.unshift({
                selector: parent.tagName + '.' + parent.className,
                color: current.backgroundColor,
                opacity: Number(current.opacity),
                image: current.backgroundImage,
              });
            }
            let background = [255, 255, 255];
            for (const ancestor of ancestors) background = blend(rgba(ancestor.color), background);
            const color = rgba(style.color);
            color[3] =
              color[3]! *
              ancestors.reduce((value, ancestor) => value * ancestor.opacity, 1) *
              (pseudo ? Number(style.opacity) : 1);
            const foreground = blend(color, background);
            const a = luminance(foreground),
              b = luminance(background);
            return {
              selector,
              pseudo,
              text: pseudo ? element.getAttribute('placeholder') : element.textContent,
              color: style.color,
              opacity: style.opacity,
              foreground,
              background,
              contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
              ancestors,
            };
          }),
      );
    });
    await writeFile(
      `${studio.folder}/text-contrast-${theme}.json`,
      JSON.stringify(measurements, null, 2),
    );
    await page.screenshot({
      path: `${studio.folder}/placeholder-${theme}.png`,
      fullPage: true,
      scale: 'css',
    });
    expect(measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '.yz-create textarea.prompt-input',
          pseudo: '::placeholder',
        }),
        ...['.yz-result-hint', '.credit-estimate-note', '.yz-note'].map((selector) =>
          expect.objectContaining({ selector, pseudo: '' }),
        ),
      ]),
    );
    for (const measurement of measurements) {
      expect
        .soft(measurement.contrast, `${measurement.selector} ${measurement.text}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });
}
