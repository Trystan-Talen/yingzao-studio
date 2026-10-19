"""Creates a disposable missing-reference fixture in the isolated database only."""
import datetime
import json
import pathlib
import sqlite3
import uuid

root = pathlib.Path(__file__).resolve().parents[3]
conn = sqlite3.connect(root / "platform/var/takeover/baseline-app/demo.sqlite")
conn.row_factory = sqlite3.Row
project_id = "9ba79435-98f6-4f7a-ac88-8b0fd4651a21"
document_id = "06f6831d-a09d-44a7-8d26-791209405352"
if conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone():
    print(json.dumps({"existing":True,"projectId":project_id}))
    raise SystemExit
source = "c5c64413-9d84-4a0b-8c34-e6edb340e149"
project = dict(conn.execute("SELECT * FROM projects WHERE id=?", (source,)).fetchone())
document = dict(conn.execute("SELECT * FROM documents WHERE project_id=?", (source,)).fetchone())
draft = json.loads(conn.execute("SELECT metadata_json FROM messages WHERE project_id=? LIMIT 1", (source,)).fetchone()[0])["draft"]
draft.update(projectId=project_id,prompt="缺失素材验收：保留可用参考，不可静默跳过缺失项",assetIds=["d024992a-a11b-49a7-a66b-9b425be98ccd","278def31-c990-46d4-b546-9eca6be67e0f"])
date = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")
project.update(id=project_id,document_id=document_id,name="接手验收 · 缺失参考恢复",description=draft["prompt"],created_at=date,updated_at=date)
document.update(id=document_id,project_id=project_id,created_at=date,updated_at=date)
with conn:
    for table,row in [("projects",project),("documents",document)]:
        conn.execute(f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})",tuple(row.values()))
    conn.execute("INSERT INTO messages(id,workspace_id,project_id,user_id,role,content,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)",(str(uuid.uuid4()),project["workspace_id"],project_id,project["created_by"],"user",draft["prompt"],json.dumps({"draft":draft},ensure_ascii=False),date))
print(json.dumps({"projectId":project_id,"references":draft["assetIds"]}))
