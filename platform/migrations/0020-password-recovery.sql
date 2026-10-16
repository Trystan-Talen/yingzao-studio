ALTER TABLE users ADD COLUMN password_revision INTEGER NOT NULL DEFAULT 0 CHECK(password_revision>=0);
CREATE TABLE password_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 purpose TEXT NOT NULL CHECK(purpose IN('reset','setup')),
 token_hash TEXT NOT NULL UNIQUE,
 email_snapshot TEXT NOT NULL,
 password_revision INTEGER NOT NULL CHECK(password_revision>=0),
 session_token_hash TEXT,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 consumed_at TEXT,
 revoked_at TEXT,
 CHECK((purpose='setup' AND session_token_hash IS NOT NULL) OR (purpose='reset' AND session_token_hash IS NULL))
);
CREATE INDEX password_requests_user ON password_requests(user_id,expires_at);
CREATE TABLE password_request_limits (
 bucket_key TEXT PRIMARY KEY,
 window_start INTEGER NOT NULL,
 attempts INTEGER NOT NULL CHECK(attempts>=0),
 last_allowed_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE account_mail_outbox (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL REFERENCES password_requests(id),
 event_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN('password-request','password-changed')),
 payload_ciphertext TEXT,
 status TEXT NOT NULL CHECK(status IN('queued','sending','retry','accepted','failed','reconciliation_required','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 lease_owner TEXT,
 lease_until TEXT,
 last_error_code TEXT,
 smtp_response_code INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 accepted_at TEXT
);
CREATE INDEX account_mail_ready ON account_mail_outbox(status,next_attempt_at,created_at);
CREATE INDEX account_mail_user ON account_mail_outbox(user_id,created_at);
