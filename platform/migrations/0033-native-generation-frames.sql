CREATE TABLE native_generation_frames (
  item_id TEXT PRIMARY KEY REFERENCES job_items(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  input_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);
