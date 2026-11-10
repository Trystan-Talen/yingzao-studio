import type { JobInput } from './jobs';

/** Preparation assigns project IDs; capability proofs are independently checked at quotation. */
export function creativeInputFingerprint(input: JobInput): string {
  const value = { ...input };
  delete value.creativeBriefId;
  delete value.projectId;
  delete value.documentId;
  delete value.baseRevision;
  delete value.capabilityRevision;
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, child]) => child !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, canonical(child)]),
      );
    return item;
  };
  return JSON.stringify(canonical(value));
}
