-- Keep the pre-calibration mask alongside the immutable raw and adopted masks.
ALTER TABLE native_generation_checkpoints RENAME TO native_generation_checkpoints_before_calibration;
CREATE TABLE native_generation_checkpoints (
  item_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('background-mask-raw','background-mask-baseline','background-mask','video-model-raw')),
  asset_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(item_id,role),
  FOREIGN KEY(item_id,workspace_id) REFERENCES job_items(id,workspace_id),
  FOREIGN KEY(asset_id,workspace_id) REFERENCES assets(id,workspace_id)
);
INSERT INTO native_generation_checkpoints SELECT * FROM native_generation_checkpoints_before_calibration;
DROP TABLE native_generation_checkpoints_before_calibration;
