-- Durable model/local intermediates are distinct from video first frames.
CREATE UNIQUE INDEX job_items_id_workspace ON job_items(id,workspace_id);
CREATE UNIQUE INDEX assets_id_workspace ON assets(id,workspace_id);
CREATE TABLE native_generation_checkpoints (
  item_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('background-mask-raw','background-mask')),
  asset_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(item_id,role),
  FOREIGN KEY(item_id,workspace_id) REFERENCES job_items(id,workspace_id),
  FOREIGN KEY(asset_id,workspace_id) REFERENCES assets(id,workspace_id)
);
CREATE TABLE native_generation_provenance (
  item_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  processing_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(item_id,workspace_id) REFERENCES job_items(id,workspace_id),
  FOREIGN KEY(asset_id,workspace_id) REFERENCES assets(id,workspace_id)
);
