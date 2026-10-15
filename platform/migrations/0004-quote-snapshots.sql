ALTER TABLE quotes ADD COLUMN items_json TEXT;
ALTER TABLE quotes ADD COLUMN used_job_id TEXT REFERENCES jobs(id);
ALTER TABLE quotes ADD COLUMN retry_job_id TEXT REFERENCES jobs(id);
