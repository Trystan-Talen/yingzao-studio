import { expect, it } from 'vitest';
import { mergeKnowledgeInput } from '../src/web/components/KnowledgeConflict';

it('merges untouched server fields and preserves explicitly changed local fields, including cleared values', () => {
  const base = { name: 'Old', facts: ['one'], brandId: 'brand-a', referenceAssetIds: ['image-a'] };
  const mine = { ...base, name: 'My edit', brandId: null };
  const latest = { ...base, name: 'Their edit', facts: ['two'], referenceAssetIds: ['image-b'] };
  expect(
    mergeKnowledgeInput<{
      name: string;
      facts: string[];
      brandId: string | null;
      referenceAssetIds: string[];
    }>(base, mine, latest),
  ).toEqual({ name: 'My edit', facts: ['two'], brandId: null, referenceAssetIds: ['image-b'] });
  expect(base.name).toBe('Old');
  expect(latest.name).toBe('Their edit');
});

it('does not treat equal independently parsed arrays as local edits or include DTO-only fields in a merge', () => {
  const base = { facts: ['one'], cautions: ['careful'] };
  const draft = { facts: ['one'], cautions: ['careful'] };
  const current = { facts: ['two'], cautions: ['updated'], version: 4, id: 'private-id' };
  expect(mergeKnowledgeInput(base, draft, current)).toEqual({
    facts: ['two'],
    cautions: ['updated'],
  });
});

it('preserves a deliberate array removal when both editors change the same field', () => {
  expect(mergeKnowledgeInput({ facts: ['one'] }, { facts: [] }, { facts: ['two'] })).toEqual({
    facts: [],
  });
});
