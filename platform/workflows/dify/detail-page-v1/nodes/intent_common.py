"""Offline mirror of contracts/creative-intent.ts; never reads files or calls services."""
import json
import math
import re

INTENT_PLACEMENTS = ("general", "main-image", "secondary-image", "detail-image", "product-video",
                     "social-image", "social-video", "ad-image", "ad-video")
INTENT_TRIM = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
INTENT_UUID = re.compile(r"(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)\Z", re.I)


def intent_fail(code="INTENT_CONTRACT_INVALID"):
    raise ValueError(code) from None


def intent_pairs(entries):
    result = {}
    for key, value in entries:
        if key in result:
            intent_fail("INTENT_DUPLICATE_KEY")
        result[key] = value
    return result


def intent_string(value, maximum, minimum=0, trim=False):
    if not isinstance(value, str):
        intent_fail("INTENT_TEXT_INVALID")
    value = value.strip(INTENT_TRIM) if trim else value
    # Zod 4.6 string limits count Unicode code points (not UTF-16 units).
    length = len(value)
    if not minimum <= length <= maximum:
        intent_fail("INTENT_TEXT_INVALID")
    return value


def intent_load(source, maximum=120000):
    intent_string(source, maximum, 1)
    if len(source.encode("utf-16-le", errors="surrogatepass")) // 2 > maximum:
        intent_fail("INTENT_JSON_TOO_LARGE")
    try:
        return json.loads(source, object_pairs_hook=intent_pairs,
                          parse_constant=lambda _: intent_fail("INTENT_JSON_INVALID"))
    except (ValueError, TypeError, RecursionError):
        intent_fail("INTENT_JSON_INVALID")


def intent_dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def intent_fields(value, required, optional=()):
    if (not isinstance(value, dict) or not set(required).issubset(value)
            or set(value) - set(required) - set(optional)):
        intent_fail("INTENT_FIELDS_INVALID")


def intent_enum(value, choices):
    if not isinstance(value, str) or value not in choices:
        intent_fail("INTENT_VALUE_INVALID")


def intent_list(value, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        intent_fail("INTENT_LIST_INVALID")
    return value


def intent_uuid(value):
    if not isinstance(value, str) or not INTENT_UUID.fullmatch(value):
        intent_fail("INTENT_ID_INVALID")


def intent_number(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        intent_fail("INTENT_NUMBER_INVALID")


def intent_datetime(value):
    from datetime import datetime
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z", value):
        intent_fail("INTENT_DATE_INVALID")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        intent_fail("INTENT_DATE_INVALID")


def validate_intent_request(value, brief=None):
    intent_fields(value, ("version", "requestId", "rawPrompt", "sourceTexts", "answers", "materials", "context", "strategy"), ("previousSummary", "memoryContext", "contextSources"))
    if type(value["version"]) is not int or value["version"] != 1:
        intent_fail("INTENT_VERSION_INVALID")
    intent_uuid(value["requestId"])
    value["rawPrompt"] = intent_string(value["rawPrompt"], 12000, 1, True)
    if brief is not None and value["rawPrompt"] != intent_string(brief, 12000, 1, True):
        intent_fail("INTENT_BRIEF_MISMATCH")
    source_ids = set()
    for source in intent_list(value["sourceTexts"], 16):
        intent_fields(source, ("id", "text"))
        intent_string(source["id"], 100, 1)
        intent_string(source["text"], 20000)
        if source["id"] in source_ids:
            intent_fail("INTENT_SOURCE_DUPLICATED")
        source_ids.add(source["id"])
    if "contextSources" in value:
        for source in intent_list(value["contextSources"], 10):
            intent_fields(source, ("kind", "id", "label", "content"), ("version", "updatedAt", "expiresAt"))
            intent_enum(source["kind"], ("brand", "product", "memory"))
            intent_uuid(source["id"])
            intent_string(source["label"], 300, 1)
            intent_string(source["content"], 20000)
            if "version" in source:
                if type(source["version"]) is not int or source["version"] < 1:
                    intent_fail("INTENT_CONTEXT_VERSION_INVALID")
            if "updatedAt" in source:
                intent_datetime(source["updatedAt"])
            if source.get("expiresAt") is not None:
                intent_datetime(source["expiresAt"])
    if "memoryContext" in value:
        memory = value["memoryContext"]
        intent_fields(memory, ("items", "omitted"))
        if type(memory["omitted"]) is not int or memory["omitted"] < 0:
            intent_fail("INTENT_MEMORY_INVALID")
        memory_size = 0
        for item in intent_list(memory["items"], 8):
            intent_fields(item, ("id", "topic", "kind", "content", "version", "updatedAt", "weight"), ("confirmedAt", "expiresAt", "halfLifeDays"))
            intent_uuid(item["id"])
            intent_enum(item["kind"], ("profile", "preference", "temporary"))
            intent_string(item["topic"], 80, 1)
            intent_string(item["content"], 2000, 1)
            memory_size += len(item["content"].encode("utf-16-le", errors="surrogatepass")) // 2
            intent_datetime(item["updatedAt"])
            if "confirmedAt" in item:
                intent_datetime(item["confirmedAt"])
            if item.get("expiresAt") is not None:
                intent_datetime(item["expiresAt"])
            if item.get("halfLifeDays") is not None and (type(item["halfLifeDays"]) is not int or not 1 <= item["halfLifeDays"] <= 3650):
                intent_fail("INTENT_MEMORY_INVALID")
            if type(item["version"]) is not int or item["version"] < 1:
                intent_fail("INTENT_CONTEXT_VERSION_INVALID")
            intent_number(item["weight"])
            if not 0 <= item["weight"] <= 1:
                intent_fail("INTENT_MEMORY_INVALID")
        if memory_size > 6000:
            intent_fail("INTENT_MEMORY_INVALID")
    if "previousSummary" in value:
        intent_string(value["previousSummary"], 2000)
    for answer in intent_list(value["answers"], 12):
        intent_fields(answer, ("questionId", "answer"))
        intent_string(answer["questionId"], 60, 1)
        answer["answer"] = intent_string(answer["answer"], 2000, 1, True)
    for material in intent_list(value["materials"], 40):
        intent_fields(material, ("id", "name", "kind", "role"), ("width", "height", "byteSize"))
        intent_uuid(material["id"])
        intent_string(material["name"], 300)
        intent_enum(material["kind"], ("image", "video", "audio", "document"))
        intent_enum(material["role"], ("reference", "input", "background", "audio", "mask"))
        for key in ("width", "height", "byteSize"):
            if key in material and (type(material[key]) is not int or material[key] <= 0):
                intent_fail("INTENT_MATERIAL_INVALID")
    context = value["context"]
    intent_fields(context, ("mediaType", "platform", "placement", "language", "count", "ratio", "resolution", "supportsReference", "supportsAudio", "supportsText"), ("market", "duration"))
    intent_enum(context["mediaType"], ("image", "video"))
    intent_enum(context["placement"], INTENT_PLACEMENTS)
    for key, limit in (("platform", 80), ("language", 30), ("ratio", 20), ("resolution", 20), ("market", 20)):
        if key in context:
            intent_string(context[key], limit)
    count = context["count"]
    intent_number(count)
    if count != int(count) or not 1 <= count <= 20:
        intent_fail("INTENT_COUNT_INVALID")
    if "duration" in context:
        intent_number(context["duration"])
    for key in ("supportsReference", "supportsAudio", "supportsText"):
        if type(context[key]) is not bool:
            intent_fail("INTENT_CAPABILITY_INVALID")
    intent_fields(value["strategy"], ("id", "guidance"))
    intent_string(value["strategy"]["id"], 160)
    intent_string(value["strategy"]["guidance"], 16000)
    return value


def validate_intent_result(value, request_value):
    # Only an absent empty-list field on an explicitly ready result is recoverable.
    if isinstance(value, dict) and value.get("status") == "ready" and "questions" not in value:
        value = {**value, "questions": []}
    intent_fields(value, ("type", "version", "requestId", "status", "brief", "summary", "assumptions", "questions", "prompt", "reviewChecklist"))
    if value["type"] != "intent-plan" or type(value["version"]) is not int or value["version"] != 1:
        intent_fail("INTENT_VERSION_INVALID")
    intent_uuid(value["requestId"])
    if value["requestId"] != request_value["requestId"]:
        intent_fail("INTENT_REQUEST_MISMATCH")
    intent_enum(value["status"], ("ready", "needs_clarification"))
    brief = value["brief"]
    intent_fields(brief, ("scope", "subject", "goal", "mediaType", "platform", "placement", "productMode", "facts", "constraints"), ("market",))
    intent_enum(brief["scope"], ("general", "product"))
    intent_enum(brief["mediaType"], ("image", "video"))
    intent_enum(brief["placement"], INTENT_PLACEMENTS)
    intent_enum(brief["productMode"], ("not-applicable", "concept", "reference"))
    for key, limit in (("subject", 300), ("goal", 500), ("platform", 80), ("market", 20)):
        if key in brief:
            intent_string(brief[key], limit)
    sources = {entry["id"]: entry["text"] for entry in request_value["sourceTexts"]}
    for fact in intent_list(brief["facts"], 16):
        intent_fields(fact, ("sourceId", "quote"))
        intent_string(fact["sourceId"], 100, 1)
        fact["quote"] = intent_string(fact["quote"], 500, 1, True)
        if fact["sourceId"] not in sources or fact["quote"] not in sources[fact["sourceId"]]:
            intent_fail("INTENT_EVIDENCE_INVALID")
    for item in intent_list(brief["constraints"], 8):
        intent_string(item, 300, 1)
    value["summary"] = intent_string(value["summary"], 800, 1, True)
    for key, count in (("assumptions", 5), ("reviewChecklist", 6)):
        for item in intent_list(value[key], count):
            intent_string(item, 240, 1)
    seen = set()
    for question in intent_list(value["questions"], 2):
        intent_fields(question, ("id", "field", "question", "reason", "options"))
        identity = question["id"]
        if not isinstance(identity, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,59}", identity) or identity in seen:
            intent_fail("INTENT_QUESTION_ID_INVALID")
        seen.add(identity)
        intent_enum(question["field"], ("subject", "reference", "conflict", "claim", "delivery", "capability"))
        for key in ("question", "reason"):
            question[key] = intent_string(question[key], 240, 1, True)
        question["options"] = [intent_string(option, 100, 1, True) for option in intent_list(question["options"], 3)]
    intent_string(value["prompt"], 5000)
    if value["status"] == "needs_clarification":
        if not value["questions"]:
            intent_fail("INTENT_QUESTION_REQUIRED")
        if value["prompt"].strip(INTENT_TRIM):
            intent_fail("INTENT_CLARIFICATION_PROMPT_INVALID")
        return value
    if value["questions"] or not value["prompt"].strip(INTENT_TRIM) or not brief["subject"].strip(INTENT_TRIM):
        intent_fail("INTENT_READY_INVALID")
    context = request_value["context"]
    if (brief["mediaType"] != context["mediaType"]
            or (context["platform"] not in ("", "通用电商") and brief["platform"] != context["platform"])
            or (context["placement"] != "general" and brief["placement"] != context["placement"])
            or brief.get("market") != context.get("market")):
        intent_fail("INTENT_CONTEXT_CHANGED")
    if brief["productMode"] == "reference":
        if not any(item["kind"] == "image" and item["role"] in ("reference", "input")
                   for item in request_value["materials"]):
            intent_fail("INTENT_REFERENCE_REQUIRED")
        if not context["supportsReference"]:
            intent_fail("INTENT_REFERENCE_UNSUPPORTED")
    if brief["scope"] == "general" and brief["productMode"] != "not-applicable":
        intent_fail("INTENT_GENERAL_PRODUCT_INVALID")
    if brief["scope"] == "product" and brief["productMode"] == "not-applicable":
        intent_fail("INTENT_PRODUCT_MODE_REQUIRED")
    if brief["placement"] in ("main-image", "secondary-image", "detail-image", "product-video") and brief["scope"] != "product":
        intent_fail("INTENT_PRODUCT_SCOPE_REQUIRED")
    return value
