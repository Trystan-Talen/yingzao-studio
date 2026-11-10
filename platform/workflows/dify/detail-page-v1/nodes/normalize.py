def main(brief: str, planning_mode: str = None, screen_count=None, ratio: str = None, intent_request_json: str = None) -> dict:
    mode = planning_mode or "ideas"
    if mode not in ("ideas", "detail-page", "intent"):
        fail("PLANNING_MODE_INVALID")
    if mode == "intent":
        value = validate_intent_request(intent_load(intent_request_json), brief)
        return {"brief": value["rawPrompt"], "planning_mode": mode, "screen_count": 6,
                "ratio": "3:4", "intent_request_json": intent_dump(value)}
    content = text(brief, 5000 if mode == "detail-page" else 8000)
    count, selected_ratio = dimensions(6 if screen_count is None or screen_count == "" else screen_count,
                                       ratio or "3:4")
    return {"brief": content, "planning_mode": mode, "screen_count": count, "ratio": selected_ratio,
            "intent_request_json": ""}
