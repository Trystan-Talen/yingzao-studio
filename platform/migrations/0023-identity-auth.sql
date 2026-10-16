ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN(0,1));
CREATE TABLE phone_identities (
 user_id TEXT PRIMARY KEY REFERENCES users(id),phone_hash TEXT NOT NULL UNIQUE,phone_ciphertext TEXT NOT NULL,masked TEXT NOT NULL,created_at TEXT NOT NULL,verified_at TEXT NOT NULL
);
CREATE TABLE sms_challenges (
 id TEXT PRIMARY KEY,purpose TEXT NOT NULL CHECK(purpose IN('login','bind','change-old','change-new')),phone_hash TEXT NOT NULL,phone_ciphertext TEXT NOT NULL,code_hash TEXT NOT NULL,browser_hash TEXT NOT NULL,user_id TEXT REFERENCES users(id),session_hash TEXT,password_revision INTEGER,old_challenge_id TEXT REFERENCES sms_challenges(id),attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),created_at TEXT NOT NULL,expires_at TEXT NOT NULL,verified_at TEXT,consumed_at TEXT,revoked_at TEXT,
 CHECK((purpose='login' AND user_id IS NULL AND session_hash IS NULL AND password_revision IS NULL) OR (purpose<>'login' AND user_id IS NOT NULL AND session_hash IS NOT NULL AND password_revision IS NOT NULL)),CHECK((purpose='change-new')=(old_challenge_id IS NOT NULL))
);
CREATE INDEX sms_challenges_expiry ON sms_challenges(expires_at,consumed_at);
CREATE INDEX sms_challenges_user ON sms_challenges(user_id,purpose);
CREATE TABLE sms_deliveries (
 id TEXT PRIMARY KEY,challenge_id TEXT NOT NULL UNIQUE REFERENCES sms_challenges(id),payload_ciphertext TEXT,status TEXT NOT NULL CHECK(status IN('queued','sending','accepted','failed','reconciliation_required','cancelled')),lease_owner TEXT,lease_until TEXT,error_code TEXT,provider_request_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL
);
CREATE INDEX sms_deliveries_ready ON sms_deliveries(status,created_at);
CREATE TABLE identity_rate_limits(bucket_key TEXT PRIMARY KEY,window_start INTEGER NOT NULL,attempts INTEGER NOT NULL,last_allowed_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE wechat_identities (
 user_id TEXT PRIMARY KEY REFERENCES users(id),app_id TEXT NOT NULL,openid TEXT NOT NULL,unionid TEXT,created_at TEXT NOT NULL,last_login_at TEXT NOT NULL,UNIQUE(app_id,openid)
);
CREATE UNIQUE INDEX wechat_union_identity ON wechat_identities(app_id,unionid) WHERE unionid IS NOT NULL;
CREATE TABLE wechat_auth_flows (
 id TEXT PRIMARY KEY,state_hash TEXT NOT NULL UNIQUE,browser_hash TEXT NOT NULL,intent TEXT NOT NULL CHECK(intent IN('login','link')),user_id TEXT REFERENCES users(id),session_hash TEXT,password_revision INTEGER,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,status TEXT NOT NULL CHECK(status IN('pending','exchanging','succeeded','failed','expired')),error_code TEXT,
 CHECK((intent='login' AND user_id IS NULL AND session_hash IS NULL AND password_revision IS NULL) OR (intent='link' AND user_id IS NOT NULL AND session_hash IS NOT NULL AND password_revision IS NOT NULL))
);
CREATE INDEX wechat_auth_expiry ON wechat_auth_flows(expires_at,status);
CREATE TABLE identity_registrations (
 id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN('sms','wechat')),identity_ciphertext TEXT,identity_hash TEXT NOT NULL,browser_hash TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT
);
CREATE INDEX identity_registrations_expiry ON identity_registrations(expires_at);
