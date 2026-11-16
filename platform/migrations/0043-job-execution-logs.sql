CREATE TABLE job_execution_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 job_id TEXT NOT NULL REFERENCES jobs(id),
 item_id TEXT NOT NULL REFERENCES job_items(id),
 provider_id TEXT NOT NULL,
 event_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX job_execution_logs_job ON job_execution_logs(workspace_id, job_id, id);
CREATE TABLE brief_execution_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 brief_id TEXT NOT NULL REFERENCES creative_briefs(id),
 provider_id TEXT NOT NULL,
 event_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX brief_execution_logs_brief ON brief_execution_logs(workspace_id, brief_id, id);
