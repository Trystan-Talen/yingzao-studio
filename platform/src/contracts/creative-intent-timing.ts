// The workflow's HTTP node allows connect 10s + read 120s + write 10s.
// Leave 20s for workflow/response overhead, then another 15s for the browser.
// These are bounded waits, not retries or recovery of an unknown upstream run.
export const CREATIVE_INTENT_SERVER_TIMEOUT_MS = 160_000;
export const CREATIVE_INTENT_CLIENT_TIMEOUT_MS = CREATIVE_INTENT_SERVER_TIMEOUT_MS + 15_000;
