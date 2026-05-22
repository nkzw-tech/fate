"""Server-Sent Events frame formatting.

Mirrors the `sse` and `sseComment` helpers in `packages/fate/src/server/http.ts`.
"""

from __future__ import annotations

import json
from typing import Any


def sse_frame(message: Any, *, event_id: str | None = None) -> bytes:
    """Format an SSE event frame.

    `message` must be JSON-serializable. The event field comes from the message's
    `kind`, which must be one of "next", "connection", or "error".
    """

    kind: str
    payload: Any
    if hasattr(message, "model_dump"):
        payload = message.model_dump(exclude_none=True)
        kind = payload.get("kind", "message")
    elif isinstance(message, dict):
        payload = message
        kind = message.get("kind", "message")
    else:
        raise TypeError("sse_frame expects a dict or a pydantic model")

    lines: list[str] = []
    if event_id:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {kind}")
    lines.append(f"data: {json.dumps(payload, separators=(',', ':'))}")
    return ("\n".join(lines) + "\n\n").encode("utf-8")


def sse_comment(message: str) -> bytes:
    return f": {message}\n\n".encode()


SSE_HEADERS: dict[str, str] = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
}


__all__ = ["SSE_HEADERS", "sse_comment", "sse_frame"]
