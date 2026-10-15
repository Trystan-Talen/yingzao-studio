CREATE TABLE upload_requests (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 asset_id TEXT NOT NULL REFERENCES assets(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,user_id,request_id)
);
CREATE TABLE job_history_archives (
 user_id TEXT NOT NULL REFERENCES users(id),
 job_id TEXT NOT NULL REFERENCES jobs(id),
 archived_at TEXT NOT NULL,
 PRIMARY KEY(user_id,job_id)
);
CREATE TABLE job_downloads (
 user_id TEXT NOT NULL REFERENCES users(id),
 job_id TEXT NOT NULL REFERENCES jobs(id),
 downloaded_at TEXT NOT NULL,
 PRIMARY KEY(user_id,job_id)
);
