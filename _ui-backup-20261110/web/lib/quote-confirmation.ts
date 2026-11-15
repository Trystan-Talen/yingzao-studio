import type { JobInput } from '../../contracts/jobs';

/** Project/document identity may be assigned while preparing a quote; creative choices may not. */
export function quoteFormFingerprint(input: JobInput) {
  return JSON.stringify({
    ...input,
    projectId: undefined,
    documentId: undefined,
    baseRevision: undefined,
  });
}
export function canConfirmQuote(
  valid: boolean,
  quotedFingerprint: string | undefined,
  currentFingerprint: string,
  expiresAt: string,
  now = Date.now(),
) {
  return valid && quotedFingerprint === currentFingerprint && Date.parse(expiresAt) > now;
}
