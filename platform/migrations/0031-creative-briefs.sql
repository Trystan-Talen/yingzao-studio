CREATE TABLE creative_briefs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  previous_id TEXT REFERENCES creative_briefs(id),
  input_fingerprint TEXT NOT NULL,
  input_json TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT,
  compiled_prompt TEXT,
  strategy_json TEXT,
  state TEXT NOT NULL CHECK(state IN ('analyzing','ready','needs_clarification','failed','uncertain')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, user_id, request_id)
);
CREATE INDEX creative_briefs_owner ON creative_briefs(workspace_id, user_id, created_at);
