import { expect, it } from 'vitest';
import { matchesNativeFrameRatio } from '../src/contracts/native-plan';
import { nativeReferenceFrameIssue } from '../src/server/tasks/native-capture';

it.each(['1:1:2', '1:1:', ':1', '0:1', 'Infinity:1'])(
  'rejects malformed ratio %s before accepting frame metadata',
  (ratio) => expect(matchesNativeFrameRatio(512, 512, ratio)).toBe(false),
);

it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
  'rejects invalid recorded byte size %s',
  (byteSize) =>
    expect(nativeReferenceFrameIssue({ width: 512, height: 512, byteSize }, '1:1')).toBe(
      'FIRST_FRAME_LIMIT',
    ),
);

it('allows old metadata without byte size but rejects exact upstream size limits', () => {
  expect(nativeReferenceFrameIssue({ width: 512, height: 512 }, '1:1')).toBeUndefined();
  expect(
    nativeReferenceFrameIssue({ width: 512, height: 512, byteSize: 30 * 1024 * 1024 }, '1:1'),
  ).toBe('FIRST_FRAME_LIMIT');
});
