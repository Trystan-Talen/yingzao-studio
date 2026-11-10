def main(body: str, status_code: int, brief: str, screen_count: int, ratio: str, model: str) -> dict:
    count, selected_ratio = dimensions(screen_count, ratio)
    content = text(brief, 5000)
    known = facts(response(body, status_code, "FACTS"), content)
    return {"facts_json": dump(known), "result": request(model, SYSTEM_PROMPT,
            {"brief": content, "facts": known, "screen_count": count, "ratio": selected_ratio}, 2048)}
