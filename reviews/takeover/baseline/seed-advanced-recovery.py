"""Explicit non-provider fixtures, only in the named isolated takeover database."""
import datetime
import hashlib
import json
import pathlib
import sqlite3
import uuid

root = pathlib.Path(__file__).resolve().parents[3]
db = root / "platform/var/takeover/baseline-app/demo.sqlite"
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
project_id = "e4cb5d31-e6f5-405c-b8a8-ef36379ccb69"
document_id = "c0632aa4-c609-4734-b136-d1ac1675f8a6"
job_id = "1fe98e3e-0615-43c3-8e22-c527940d8489"
item_id = "6d9e32a8-65c2-4bc4-8b9b-dc68c086cc8e"
asset_id = "d024992a-a11b-49a7-a66b-9b425be98ccd"
source = "e9eb193b-e6c7-497f-b8d7-d00655054914"
now = datetime.datetime.now(datetime.timezone.utc)
date = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
project = dict(conn.execute("SELECT * FROM projects WHERE id=?", (source,)).fetchone())
document = dict(conn.execute("SELECT * FROM documents WHERE project_id=?", (source,)).fetchone())
draft = json.loads(conn.execute("SELECT metadata_json FROM messages WHERE project_id=? ORDER BY created_at LIMIT 1", (source,)).fetchone()[0])["draft"]
draft.update(projectId=project_id, operation="image.text-edit", providerId="flyelep", prompt="高级工具长会话验收：旧参数不可静默覆盖", assetIds=[asset_id], referenceAssetIds=[])
draft["options"].update(model="retired-fixture-model", resolution="8K", duration=10, textReplacements=[{"originalText":"原字", "replaceText":"长会话恢复新字", "rect":[0,0,100,40]}])
with conn:
    if not conn.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
        project.update(id=project_id, document_id=document_id, name="接手验收 · 进阶恢复测试夹具", description="502条本机测试消息，无外部生成", created_at=date, updated_at=date)
        document.update(id=document_id, project_id=project_id, created_at=date, updated_at=date)
        for table, row in [("projects",project),("documents",document)]:
            conn.execute(f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", tuple(row.values()))
        for index in range(502):
            value = draft if index == 0 else {**draft,"operation":"text.assist","prompt":f"进阶恢复测试辅助消息{index}"}
            at=(now-datetime.timedelta(minutes=502-index)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            conn.execute("INSERT INTO messages(id,workspace_id,project_id,user_id,role,content,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)", (str(uuid.uuid4()),project["workspace_id"],project_id,project["created_by"],"user",value["prompt"],json.dumps({"draft":value},ensure_ascii=False),at))
    if not conn.execute("SELECT 1 FROM jobs WHERE id=?", (job_id,)).fetchone():
        value={**draft,"operation":"image.ocr","providerId":"openai","prompt":"测试夹具：文字识别与区域草稿恢复，无外部生成"}
        value["options"]={**draft["options"],"model":"gpt-5.5"}
        encoded=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"))
        asset=conn.execute("SELECT width,height FROM assets WHERE id=?",(asset_id,)).fetchone()
        result={"imageAssetId":asset_id,"imageWidth":asset["width"],"imageHeight":asset["height"],"coordinateSource":"model-estimate","regions":[{"text":"区域一测试文字","rect":[0,0,100,40]},{"text":"区域二独立测试文字","rect":[0,50,100,40]}]}
        conn.execute("INSERT INTO jobs(id,workspace_id,user_id,project_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,settled_credits,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(job_id,project["workspace_id"],project["created_by"],project_id,"image.ocr","openai",value["prompt"],encoded,hashlib.sha256(encoded.encode()).hexdigest(),str(uuid.uuid4()),"fixture-not-billable","succeeded","本地交互测试夹具 · 无外部生成",0,0,date,date))
        conn.execute("INSERT INTO job_items(id,job_id,workspace_id,user_id,item_index,input_json,status,phase,credits,result_text,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(item_id,job_id,project["workspace_id"],project["created_by"],0,encoded,"succeeded","settled",0,json.dumps(result,ensure_ascii=False),date,date,date))
print(json.dumps({"projectId":project_id,"ocrJobId":job_id,"ocrItemId":item_id,"messages":502,"fixture":True}))
