"""Shared offline validation copied into Dify code nodes by build.mjs."""
import json
import re


def fail(code="DETAIL_PAGE_CONTRACT_INVALID"):
    raise ValueError(code) from None


def pairs(entries):
    result = {}
    for key, value in entries:
        if key in result:
            fail("DETAIL_PAGE_DUPLICATE_KEY")
        result[key] = value
    return result


def load(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 262144:
        fail("DETAIL_PAGE_JSON_INVALID")
    try:
        return json.loads(value, object_pairs_hook=pairs,
                          parse_constant=lambda _: fail("DETAIL_PAGE_JSON_INVALID"))
    except (ValueError, TypeError, RecursionError):
        fail("DETAIL_PAGE_JSON_INVALID")


def dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def fields(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected):
        fail("DETAIL_PAGE_FIELDS_INVALID")


def text(value, limit=500):
    if not isinstance(value, str):
        fail("DETAIL_PAGE_TEXT_INVALID")
    # Match JavaScript trim() and Zod's UTF-16 string length at the receiving API.
    trimmed = value.strip("\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    try:
        units = len(trimmed.encode("utf-16-le")) // 2
    except UnicodeEncodeError:
        fail("DETAIL_PAGE_TEXT_INVALID")
    if not trimmed or units > limit:
        fail("DETAIL_PAGE_TEXT_INVALID")
    return trimmed


def texts(value, minimum=0, maximum=12, limit=500):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        fail("DETAIL_PAGE_LIST_INVALID")
    return [text(entry, limit) for entry in value]


def dimensions(screen_count, ratio):
    if type(screen_count) not in (int, float) or screen_count != int(screen_count) or not 2 <= screen_count <= 10:
        fail("DETAIL_PAGE_SCREEN_COUNT_INVALID")
    if ratio not in ("3:4", "2:3", "9:16"):
        fail("DETAIL_PAGE_RATIO_INVALID")
    return int(screen_count), ratio


def response(body, status_code, stage=None):
    if type(status_code) not in (int, float) or status_code != 200:
        if stage in ("FACTS", "VISUAL", "SCREENS"):
            allowed_statuses = (400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504)
            status = str(int(status_code)) if type(status_code) in (int, float) and status_code in allowed_statuses else "OTHER"
            fail("DETAIL_PAGE_" + stage + "_HTTP_" + status)
        fail("DETAIL_PAGE_RESPONSE_STATUS_INVALID")
    envelope = load(body)
    if not isinstance(envelope, dict):
        fail("DETAIL_PAGE_RESPONSE_INVALID")
    choices = envelope.get("choices")
    if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
        fail("DETAIL_PAGE_RESPONSE_INVALID")
    if choices[0].get("finish_reason") not in (None, "stop"):
        fail("DETAIL_PAGE_RESPONSE_INCOMPLETE")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        fail("DETAIL_PAGE_RESPONSE_INVALID")
    content = text(message.get("content"), 65536)
    if content.startswith("```"):
        match = re.fullmatch(r"```json[ \t]*\r?\n(.*?)\r?\n```", content, re.I | re.S)
        if not match:
            fail("DETAIL_PAGE_JSON_INVALID")
        content = match.group(1)
    result = load(content)
    if not isinstance(result, dict):
        fail("DETAIL_PAGE_JSON_INVALID")
    return result


def request(model, system_prompt, user_data, max_tokens):
    if model != "kimi-k3":
        fail("DETAIL_PAGE_MODEL_UNSUPPORTED")
    return dump({"model": model, "stream": False, "max_tokens": max_tokens,
                 "messages": [{"role": "system", "content": system_prompt},
                              {"role": "user", "content": dump(user_data)}]})


def facts(value, brief):
    fields(value, ["productName", "productFacts", "unknowns"])
    name = text(value["productName"], 120)
    known = texts(value["productFacts"], 1)
    unknown = texts(value["unknowns"])
    if name != "待确认商品" and name not in brief:
        fail("DETAIL_PAGE_FACT_NOT_IN_BRIEF")
    if any(fact not in brief for fact in known):
        fail("DETAIL_PAGE_FACT_NOT_IN_BRIEF")
    return {"productName": name, "productFacts": known, "unknowns": unknown}


def finished_content(value):
    placeholders = ("品牌待确认", "容量待确认", "价格待补充", "售后待补充",
                    "价格售后待补充", "价格/售后待补充", "参数待填", "参考图待确认", "待确认商品")
    if any(placeholder in value for placeholder in placeholders):
        fail("DETAIL_PAGE_INTERNAL_PLACEHOLDER")
    return value


def visual(value):
    fields(value, ["audience", "visualStyle", "palette", "consistencyNotes", "unknowns"])
    return {"audience": text(value["audience"]), "visualStyle": finished_content(text(value["visualStyle"])),
            "palette": texts(value["palette"], 1, 6, 60),
            "consistencyNotes": finished_content(text(value["consistencyNotes"])), "unknowns": texts(value["unknowns"])}


def screens(value, screen_count, ratio, brief):
    fields(value, ["screens"])
    items = value["screens"]
    if not isinstance(items, list) or len(items) != screen_count:
        fail("DETAIL_PAGE_SCREEN_COUNT_MISMATCH")
    seen = set()
    claims = ("抗菌", "抑菌", "治愈", "治疗", "无毒", "食品级", "认证", "专利",
              "纯天然", "零添加", "防过敏", "减肥", "防癌", "销量第一", "全网最低", "FDA", "ISO")
    source_numbers = set(re.findall(r"\d+(?:\.\d+)?", brief))
    for item in items:
        fields(item, ["id", "title", "purpose", "copy", "prompt", "ratio"])
        identity = text(item["id"], 40)
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,39}", identity) or identity in seen:
            fail("DETAIL_PAGE_SCREEN_ID_INVALID")
        seen.add(identity)
        item["id"] = identity
        item["title"] = text(item["title"], 80)
        item["purpose"] = text(item["purpose"], 300)
        item["copy"] = texts(item["copy"], 0, 4, 150)
        item["prompt"] = text(item["prompt"], 1000)
        for content in [item["title"], item["prompt"], *item["copy"]]:
            finished_content(content)
        if item["ratio"] != ratio:
            fail("DETAIL_PAGE_RATIO_MISMATCH")
        visible = " ".join([item["title"], *item["copy"]])
        if set(re.findall(r"\d+(?:\.\d+)?", visible)) - source_numbers:
            fail("DETAIL_PAGE_UNSOURCED_NUMBER")
        if any(claim in visible and claim not in brief for claim in claims):
            fail("DETAIL_PAGE_UNSOURCED_CLAIM")
    return items
