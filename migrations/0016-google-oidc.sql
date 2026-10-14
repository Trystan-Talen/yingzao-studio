CREATE TABLE external_identities (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider='google'),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  UNIQUE(issuer,subject),
  UNIQUE(user_id,provider)
);
CREATE TABLE google_oidc_flows (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  browser_hash TEXT NOT NULL,
  intent TEXT NOT NULL CHECK(intent IN ('login','link')),
  user_id TEXT REFERENCES users(id),
  session_token_hash TEXT,
  encrypted_context TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','exchanging','succeeded','failed','expired')),
  error_code TEXT,
  CHECK((intent='login' AND user_id IS NULL AND session_token_hash IS NULL) OR (intent='link' AND user_id IS NOT NULL AND session_token_hash IS NOT NULL))
);
CREATE INDEX google_flows_expiry ON google_oidc_flows(expires_at,status);
CREATE TABLE external_identity_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
