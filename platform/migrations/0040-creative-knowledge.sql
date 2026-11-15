CREATE TABLE creative_memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  topic TEXT NOT NULL COLLATE NOCASE,
  content TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('profile','preference','temporary')),
  media_type TEXT NOT NULL CHECK(media_type IN ('all','image','video')),
  expires_at TEXT,
  half_life_days INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','paused')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  UNIQUE(workspace_id,user_id,topic,media_type)
);
CREATE INDEX creative_memories_owner ON creative_memories(workspace_id,user_id);
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  facts_json TEXT NOT NULL DEFAULT '[]',
  cautions_json TEXT NOT NULL DEFAULT '[]',
  brand_id TEXT REFERENCES brands(id),
  reference_asset_ids_json TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL CHECK(visibility IN ('private','workspace')),
  valid_until TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX products_workspace ON products(workspace_id,deleted_at,updated_at);
