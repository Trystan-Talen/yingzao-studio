CREATE TABLE model_connections (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK(kind IN ('text','image','video')),
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  models_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  encrypted_secret TEXT,
  key_hint TEXT,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  models_json TEXT NOT NULL DEFAULT '[]',
  models_checked_at TEXT,
  discovery_status TEXT NOT NULL DEFAULT 'never',
  PRIMARY KEY(workspace_id, kind)
);
