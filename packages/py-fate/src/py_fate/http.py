"""Framework-agnostic request/response value objects.

`FateServer` only depends on these — no Starlette, FastAPI, or AIOHTTP types are
imported by the core. Web framework adapters convert their native request type
into a `FateHTTPRequest` and translate `FateHTTPResponse` / `FateSSEResponse`
back into their native response type.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class FateHTTPRequest:
    """Minimal HTTP request the protocol layer needs."""

    method: str
    url: str
    headers: Mapping[str, str]
    read_body: Callable[[], Awaitable[bytes]]
    _cached_body: bytes | None = None

    async def body(self) -> bytes:
        if self._cached_body is None:
            self._cached_body = await self.read_body()
        return self._cached_body

    async def json(self) -> Any:
        raw = await self.body()
        if not raw:
            return None
        return json.loads(raw)


@dataclass(slots=True)
class FateHTTPResponse:
    status: int
    headers: dict[str, str]
    body: bytes


@dataclass(slots=True)
class FateSSEResponse:
    """SSE response: caller iterates `frames` and writes them as they arrive."""

    status: int
    headers: dict[str, str]
    frames: AsyncIterator[bytes]
    on_close: Callable[[], Awaitable[None]] | None = None


JSON_HEADERS: dict[str, str] = {"content-type": "application/json; charset=utf-8"}


def json_response(payload: Any, *, status: int = 200) -> FateHTTPResponse:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return FateHTTPResponse(status=status, headers=dict(JSON_HEADERS), body=body)


__all__ = [
    "FateHTTPRequest",
    "FateHTTPResponse",
    "FateSSEResponse",
    "JSON_HEADERS",
    "json_response",
]
