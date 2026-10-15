CREATE TABLE translation_text_checks (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  asset_sha256 TEXT NOT NULL,
  detector_id TEXT NOT NULL,
  has_text INTEGER NOT NULL CHECK(has_text IN(0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,asset_sha256,detector_id)
);
