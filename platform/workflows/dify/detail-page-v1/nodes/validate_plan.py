def main(body: str, status_code: int, facts_json: str, visual_json: str, brief: str, screen_count: int, ratio: str) -> dict:
    count, selected_ratio = dimensions(screen_count, ratio)
    content = text(brief, 5000)
    known = facts(load(facts_json), content)
    style = visual(load(visual_json))
    items = screens(response(body, status_code, "SCREENS"), count, selected_ratio, content)
    unknown = list(dict.fromkeys([*known["unknowns"], *style.pop("unknowns")]))
    # Each validated stage permits 12 unknowns. Preserve all distinct statements in order.
    texts(unknown, 0, 24)
    plan = {**known, **style, "unknowns": unknown, "screens": items}
    result = dump({"type": "detail-page-plan", "version": 1, "plan": plan})
    if len(result) > 65536:
        fail("DETAIL_PAGE_RESULT_TOO_LARGE")
    return {"result": result}
