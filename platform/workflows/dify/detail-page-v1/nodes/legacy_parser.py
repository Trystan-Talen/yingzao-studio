"""Dify（工作流编排平台）代码节点：只验证响应，不联网。"""

import json
import math
import re


TOP_FIELDS = {
    "schema_version", "status", "delivery_type", "product_facts", "unknowns",
    "creative_direction", "image_tasks", "video_shots", "voiceover_text", "questions",
}
IMAGE_FIELDS = {"id", "purpose", "prompt", "reference_required"}
VIDEO_FIELDS = {"id", "source_image_id", "prompt", "duration_seconds"}
ID_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}\Z")
FENCE_PATTERN = re.compile(r"```json[ \t]*\r?\n(.*?)\r?\n```", re.DOTALL | re.IGNORECASE)


def _fail(code: str):
    # 只抛固定错误码；不回显需求、密钥或服务商响应体。
    raise ValueError(code) from None


def _object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail("RESPONSE_JSON_INVALID")
        result[key] = value
    return result


def _constant(_value):
    _fail("RESPONSE_JSON_INVALID")


def _load(value: str):
    try:
        return json.loads(value, object_pairs_hook=_object_pairs, parse_constant=_constant)
    except (ValueError, TypeError, RecursionError):
        _fail("RESPONSE_JSON_INVALID")


def _exact_fields(value, fields):
    if not isinstance(value, dict) or set(value) != fields:
        _fail("PLAN_FIELDS_INVALID")


def _text(value, nonempty=False, limit=12000):
    if not isinstance(value, str) or len(value) > limit or (nonempty and not value.strip()):
        _fail("PLAN_TEXT_INVALID")


def _text_list(value):
    if not isinstance(value, list) or len(value) > 50:
        _fail("PLAN_LIST_INVALID")
    for entry in value:
        _text(entry, nonempty=True, limit=4000)


def _identifier(value):
    if not isinstance(value, str) or ID_PATTERN.fullmatch(value) is None:
        _fail("PLAN_ID_INVALID")


def _validate(plan):
    _exact_fields(plan, TOP_FIELDS)
    if plan["schema_version"] != "1.0" or plan["status"] != "needs_confirmation":
        _fail("PLAN_STATE_INVALID")
    delivery = plan["delivery_type"]
    if not isinstance(delivery, str) or delivery not in {"image", "video", "both", "unclear"}:
        _fail("PLAN_DELIVERY_INVALID")
    for name in ("product_facts", "unknowns", "questions"):
        _text_list(plan[name])
    for name in ("creative_direction", "voiceover_text"):
        _text(plan[name])
    images, videos = plan["image_tasks"], plan["video_shots"]
    if not isinstance(images, list) or not isinstance(videos, list):
        _fail("PLAN_TASKS_INVALID")
    if len(images) > 3 or len(videos) > 3:
        _fail("PLAN_TASK_LIMIT")
    identifiers, image_ids = set(), set()
    for task in images:
        _exact_fields(task, IMAGE_FIELDS)
        _identifier(task["id"])
        if task["id"] in identifiers:
            _fail("PLAN_ID_DUPLICATED")
        identifiers.add(task["id"])
        image_ids.add(task["id"])
        _text(task["purpose"], nonempty=True)
        _text(task["prompt"], nonempty=True)
        if type(task["reference_required"]) is not bool:
            _fail("PLAN_REFERENCE_FLAG_INVALID")
    unknown_duration = False
    for shot in videos:
        _exact_fields(shot, VIDEO_FIELDS)
        _identifier(shot["id"])
        if shot["id"] in identifiers:
            _fail("PLAN_ID_DUPLICATED")
        identifiers.add(shot["id"])
        _identifier(shot["source_image_id"])
        if shot["source_image_id"] not in image_ids:
            _fail("PLAN_SOURCE_REFERENCE_INVALID")
        _text(shot["prompt"], nonempty=True)
        duration = shot["duration_seconds"]
        if type(duration) not in (int, float) or not (0 <= duration <= 15) or not math.isfinite(duration):
            _fail("PLAN_DURATION_INVALID")
        unknown_duration = unknown_duration or duration == 0
    if delivery == "image" and (not images or videos):
        _fail("PLAN_DELIVERY_TASKS_INVALID")
    if delivery in {"video", "both"} and (not videos or not images):
        _fail("PLAN_DELIVERY_TASKS_INVALID")
    if (delivery == "unclear" or unknown_duration) and not plan["questions"]:
        _fail("PLAN_CONFIRMATION_REQUIRED")


def main(body: str, status_code: int) -> dict:
    """验证兼容响应与计划，返回固定排序的 JSON（结构化数据）字符串。"""
    if type(status_code) is not int or status_code != 200:
        _fail("RESPONSE_STATUS_INVALID")
    if not isinstance(body, str) or not body.strip() or len(body) > 262144:
        _fail("RESPONSE_BODY_INVALID")
    envelope = _load(body)
    if not isinstance(envelope, dict):
        _fail("RESPONSE_ENVELOPE_INVALID")
    choices = envelope.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        _fail("RESPONSE_ENVELOPE_INVALID")
    message = choices[0].get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), str):
        _fail("RESPONSE_CONTENT_INVALID")
    content = message["content"].strip()
    if not content or len(content) > 65536:
        _fail("RESPONSE_CONTENT_INVALID")
    if content.startswith("```"):
        fenced = FENCE_PATTERN.fullmatch(content)
        if not fenced:
            _fail("RESPONSE_JSON_INVALID")
        content = fenced.group(1).strip()
    plan = _load(content)
    _validate(plan)
    return {
        "result": json.dumps(
            plan, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
    }

