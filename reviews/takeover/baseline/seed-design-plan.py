"""Adds an explicitly labelled, non-provider UI fixture to the isolated test project."""
import datetime
import hashlib
import json
import pathlib
import sqlite3
import uuid

root = pathlib.Path(__file__).resolve().parents[3]
conn = sqlite3.connect(root / "platform/var/takeover/baseline-app/demo.sqlite")
conn.row_factory = sqlite3.Row
project_id = "e9eb193b-e6c7-497f-b8d7-d00655054914"
job_id = "6cd3baf8-5e53-4360-8011-7caf18542f98"
if conn.execute("SELECT id FROM jobs WHERE id=?", (job_id,)).fetchone():
    print(json.dumps({"existing": True, "jobId": job_id}))
    raise SystemExit
project = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
value = json.loads(conn.execute("SELECT metadata_json FROM messages WHERE project_id=? ORDER BY created_at LIMIT 1", (project_id,)).fetchone()[0])["draft"]
value.update(operation="text.assist", prompt="测试夹具：结构化方案交互，无外部生成")
value["options"]["assistantMode"] = "design-plan"
value["options"]["model"] = "gpt-5.5"
encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
plan = {
    "analysis": "本方案为隔离环境交互测试夹具，没有调用外部生成服务。",
    "objective": "验证植物精华瓶设计方案可以编辑与应用",
    "style": "自然摄影", "palette": ["米白", "深绿"],
    "composition": "主体居中", "copy": ["测试文案"], "scene": "柔和窗光",
    "technical": {"ratio": "3:4", "resolution": "8K", "language": "zh-CN"},
    "directions": [{"title": f"测试方向{i}", "prompt": f"采用测试构图{i}，不代表真实生成质量"} for i in range(1, 4)],
}
date = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
with conn:
    conn.execute("INSERT INTO jobs(id,workspace_id,user_id,project_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,settled_credits,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (job_id,project["workspace_id"],project["created_by"],project_id,"text.assist","openai",value["prompt"],encoded,hashlib.sha256(encoded.encode()).hexdigest(),str(uuid.uuid4()),"fixture-not-billable","succeeded","本地交互测试夹具 · 无外部生成",0,0,date,date))
    conn.execute("INSERT INTO job_items(id,job_id,workspace_id,user_id,item_index,input_json,status,phase,credits,result_data_json,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (str(uuid.uuid4()),job_id,project["workspace_id"],project["created_by"],0,encoded,"succeeded","settled",0,json.dumps({"type":"design-plan","version":1,"plan":plan},ensure_ascii=False),date,date,date))
print(json.dumps({"projectId":project_id,"jobId":job_id,"fixture":True},ensure_ascii=False))
