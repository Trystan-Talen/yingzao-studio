CREATE TABLE inspirations (
 id TEXT PRIMARY KEY,
 workspace_id TEXT REFERENCES workspaces(id),
 asset_id TEXT REFERENCES assets(id),
 data_json TEXT NOT NULL,
 created_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 archived_at TEXT
);
CREATE INDEX inspirations_workspace ON inspirations(workspace_id,archived_at,created_at);
