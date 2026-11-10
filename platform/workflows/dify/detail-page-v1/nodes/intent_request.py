def main(intent_request_json: str, model: str) -> dict:
    value = validate_intent_request(intent_load(intent_request_json))
    if model != "kimi-k3":
        intent_fail("INTENT_MODEL_UNSUPPORTED")
    return {"result": intent_dump({
        "model": model, "stream": False, "max_tokens": 8192,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                     {"role": "user", "content": intent_dump(value)}],
    })}
