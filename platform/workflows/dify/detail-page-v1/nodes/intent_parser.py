def main(body: str, status_code, intent_request_json: str) -> dict:
    if type(status_code) not in (int, float) or status_code != 200:
        intent_fail("INTENT_RESPONSE_STATUS_INVALID")
    request_value = validate_intent_request(intent_load(intent_request_json))
    envelope = intent_load(body, 262144)
    choices = envelope.get("choices") if isinstance(envelope, dict) else None
    if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
        intent_fail("INTENT_RESPONSE_INVALID")
    if choices[0].get("finish_reason") not in (None, "stop"):
        intent_fail("INTENT_RESPONSE_INCOMPLETE")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        intent_fail("INTENT_RESPONSE_INVALID")
    content = intent_string(message.get("content"), 65536, 1, True)
    if content.startswith("```"):
        match = re.fullmatch(r"```json[ \t]*\r?\n(.*?)\r?\n```", content, re.I | re.S)
        if not match:
            intent_fail("INTENT_JSON_INVALID")
        content = match.group(1)
    result = validate_intent_result(intent_load(content, 65536), request_value)
    return {"result": intent_dump(result)}
