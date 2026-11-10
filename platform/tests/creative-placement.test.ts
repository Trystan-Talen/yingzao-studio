import { expect, it } from 'vitest';
import { resolveCreativePlacement } from '../src/contracts/creative-intent';

it.each([
  ['video', 'product', 'product-video'],
  ['video', 'social', 'social-video'],
  ['video', 'brand', 'ad-video'],
  ['image', 'detail', 'detail-image'],
  ['image', 'main-secondary', 'general'],
  ['image', 'white-background', 'general'],
  ['image', 'marketing', 'general'],
  ['image', 'free', 'general'],
  ['video', 'free', 'general'],
] as const)(
  'carries the selected %s/%s use without inventing a narrower placement',
  (mediaType, kind, expected) => {
    expect(resolveCreativePlacement({ mediaType, kind })).toBe(expected);
  },
);

it('preserves an explicitly supplied placement and does not reuse a kind from another medium', () => {
  expect(
    resolveCreativePlacement({
      mediaType: 'image',
      kind: 'main-secondary',
      placement: 'secondary-image',
    }),
  ).toBe('secondary-image');
  expect(resolveCreativePlacement({ mediaType: 'image', kind: 'social' })).toBe('general');
  expect(resolveCreativePlacement({ mediaType: 'video', kind: 'detail' })).toBe('general');
});
