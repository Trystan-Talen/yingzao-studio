-- Preserve existing billing policy while supporting explicitly configured team concurrency up to 100.
-- Worker provider and per-process capacity protections remain independent.
CREATE TABLE workspace_billing_capacity (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  credit_mode TEXT NOT NULL DEFAULT 'shared' CHECK(credit_mode IN ('shared','allocated')),
  concurrency_limit INTEGER NOT NULL DEFAULT 2 CHECK(concurrency_limit BETWEEN 1 AND 100),
  payment_review_required INTEGER NOT NULL DEFAULT 0 CHECK(payment_review_required IN (0,1))
);
INSERT INTO workspace_billing_capacity(workspace_id,credit_mode,concurrency_limit,payment_review_required)
SELECT workspace_id,credit_mode,concurrency_limit,payment_review_required FROM workspace_billing;
DROP TABLE workspace_billing;
ALTER TABLE workspace_billing_capacity RENAME TO workspace_billing;
