CREATE TABLE mail_outbox (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 event_key TEXT NOT NULL UNIQUE,
 event_type TEXT NOT NULL CHECK(event_type IN ('invitation','notification','support-reply')),
 source_id TEXT NOT NULL,
 payload_ciphertext TEXT,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','retry','accepted','failed','reconciliation_required','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at TEXT NOT NULL,
 lease_owner TEXT,
 lease_until TEXT,
 last_error_code TEXT,
 smtp_response_code INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 accepted_at TEXT
);
CREATE INDEX mail_outbox_ready ON mail_outbox(status,next_attempt_at,created_at);
CREATE INDEX mail_outbox_workspace ON mail_outbox(workspace_id,created_at);
CREATE TABLE mail_outbox_actions (
 id TEXT PRIMARY KEY,
 outbox_id TEXT NOT NULL REFERENCES mail_outbox(id),
 operator_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('retry-confirmed-not-accepted','confirm-accepted','cancel')),
 evidence_reference TEXT NOT NULL,
 created_at TEXT NOT NULL
);
