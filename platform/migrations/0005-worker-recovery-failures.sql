ALTER TABLE job_items ADD COLUMN recovery_failures INTEGER NOT NULL DEFAULT 0 CHECK(recovery_failures >= 0);
