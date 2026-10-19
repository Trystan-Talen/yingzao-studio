"""Creates only the named takeover fixture in the isolated demo database."""
import datetime
import json
import pathlib
import sqlite3
import uuid

root = pathlib.Path(__file__).resolve().parents[3]
db = root / "platform/var/takeover/baseline-app/demo.sqlite"
source = "c5c64413-9d84-4a0b-8c34-e6edb340e149"
project_id = "e9eb193b-e6c7-497f-b8d7-d00655054914"
document_id = "653c5d64-6963-4c8e-aaf1-3a46076a1718"
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
if conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone():
    print(json.dumps({"existing": True, "projectId": project_id}))
    raise SystemExit
project = dict(conn.execute("SELECT * FROM projects WHERE id=?", (source,)).fetchone())
document = dict(conn.execute("SELECT * FROM documents WHERE project_id=?", (source,)).fetchone())
draft = json.loads(conn.execute("SELECT metadata_json FROM messages WHERE project_id=? LIMIT 1", (source,)).fetchone()[0])["draft"]
draft.update(projectId=project_id, prompt="长会话验收：最旧媒体草稿必须恢复")
now = datetime.datetime.now(datetime.timezone.utc)
date = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
project.update(id=project_id, document_id=document_id, name="接手验收 · 长会话恢复", description="隔离测试夹具：101 条辅助消息之后保留 1 条更早媒体草稿", created_at=date, updated_at=date)
document.update(id=document_id, project_id=project_id, created_at=date, updated_at=date)
with conn:
    for table, row in [("projects", project), ("documents", document)]:
        conn.execute(f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", tuple(row.values()))
    for index in range(102):
        value = draft if index == 0 else {**draft, "operation": "text.assist", "prompt": f"长会话验收：辅助消息 {index}"}
        at = (now - datetime.timedelta(minutes=102-index)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        conn.execute("INSERT INTO messages(id,workspace_id,project_id,user_id,role,content,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)", (str(uuid.uuid4()), project["workspace_id"], project_id, project["created_by"], "user", value["prompt"], json.dumps({"draft": value}, ensure_ascii=False), at))
print(json.dumps({"projectId": project_id, "messages": 102, "mediaDraft": draft["prompt"]}, ensure_ascii=False))
