ALTER TABLE job_items ADD COLUMN output_kind TEXT NOT NULL DEFAULT 'single' CHECK(output_kind IN ('single','layers'));
CREATE TABLE job_item_assets (item_id TEXT NOT NULL REFERENCES job_items(id),asset_id TEXT NOT NULL REFERENCES assets(id),output_index INTEGER NOT NULL CHECK(output_index>=0),PRIMARY KEY(item_id,output_index),UNIQUE(item_id,asset_id));
INSERT INTO job_item_assets(item_id,asset_id,output_index) SELECT id,asset_id,0 FROM job_items WHERE asset_id IS NOT NULL;
ALTER TABLE pending_applies ADD COLUMN asset_ids_json TEXT;
ALTER TABLE pending_applies ADD COLUMN output_kind TEXT NOT NULL DEFAULT 'single' CHECK(output_kind IN ('single','layers'));
