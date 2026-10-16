CREATE TABLE inspiration_reuses (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  inspiration_id TEXT NOT NULL REFERENCES inspirations(id),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,user_id,request_id)
);
