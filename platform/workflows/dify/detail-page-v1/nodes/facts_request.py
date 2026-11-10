def main(brief: str, model: str) -> dict:
    content = text(brief, 5000)
    return {"result": request(model, SYSTEM_PROMPT, {"brief": content}, 2048)}
