def main(body: str, status_code: int, facts_json: str, brief: str, screen_count: int, ratio: str, model: str) -> dict:
    count, selected_ratio = dimensions(screen_count, ratio)
    content = text(brief, 5000)
    known = facts(load(facts_json), content)
    style = visual(response(body, status_code, "VISUAL"))
    return {"visual_json": dump(style), "result": request(model, SYSTEM_PROMPT,
            {"brief": content, "facts": known, "visual": style, "screen_count": count, "ratio": selected_ratio}, 8192)}
