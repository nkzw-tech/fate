"""Generic ASGI 3.0 adapter.

Mounts a FateServer at any path prefix and routes:
- POST /<prefix>           -> handle_request
- GET  /<prefix>/live      -> handle_live_get (SSE)
- POST /<prefix>/live      -> handle_live_post

Works with any ASGI server (uvicorn, hypercorn, daphne) and any framework that
can mount a sub-app (Starlette, Litestar, FastAPI via app.mount).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from ..http import FateHTTPRequest, FateHTTPResponse, FateSSEResponse
from ..server import FateServer

ASGIScope = dict[str, Any]
ASGIReceive = Callable[[], Awaitable[dict[str, Any]]]
ASGISend = Callable[[dict[str, Any]], Awaitable[None]]
ASGIApp = Callable[[ASGIScope, ASGIReceive, ASGISend], Awaitable[None]]


def fate_asgi_app(server: FateServer, *, prefix: str = "") -> ASGIApp:
    """Return an ASGI app that serves the fate protocol.

    `prefix` is matched against the request path. Routes inside the prefix:
    - `""`            (POST) -> handle_request
    - `"/live"`       (GET)  -> handle_live_get
    - `"/live"`       (POST) -> handle_live_post
    """

    normalized_prefix = prefix.rstrip("/")

    async def app(scope: ASGIScope, receive: ASGIReceive, send: ASGISend) -> None:
        if scope["type"] != "http":
            await _send_error(send, 400, b"Only HTTP requests are supported.")
            return

        path: str = scope.get("path", "")
        if normalized_prefix and not path.startswith(normalized_prefix):
            await _send_error(send, 404, b"Not found.")
            return

        inner = path[len(normalized_prefix) :] if normalized_prefix else path
        method: str = scope.get("method", "GET").upper()

        request = _scope_to_request(scope, receive)

        if inner in ("", "/"):
            if method != "POST":
                await _send_error(send, 405, b"Method not allowed.")
                return
            response = await server.handle_request(request)
            await _send_response(send, response)
            return

        if inner in ("/live", "/live/"):
            if method == "GET":
                live = await server.handle_live_get(request)
                if isinstance(live, FateSSEResponse):
                    await _send_sse(send, live)
                else:
                    await _send_response(send, live)
                return
            if method == "POST":
                response = await server.handle_live_post(request)
                await _send_response(send, response)
                return
            await _send_error(send, 405, b"Method not allowed.")
            return

        await _send_error(send, 404, b"Not found.")

    return app


def _scope_to_request(scope: ASGIScope, receive: ASGIReceive) -> FateHTTPRequest:
    method: str = scope.get("method", "GET")
    raw_path: str = scope.get("path", "")
    raw_query: bytes = scope.get("query_string", b"")
    url = raw_path + (f"?{raw_query.decode('latin-1')}" if raw_query else "")

    headers: dict[str, str] = {}
    for name, value in scope.get("headers") or []:
        headers[name.decode("latin-1").lower()] = value.decode("latin-1")

    async def read_body() -> bytes:
        chunks: list[bytes] = []
        while True:
            message = await receive()
            if message["type"] == "http.request":
                body = message.get("body") or b""
                if body:
                    chunks.append(body)
                if not message.get("more_body"):
                    break
            elif message["type"] == "http.disconnect":
                break
        return b"".join(chunks)

    return FateHTTPRequest(method=method, url=url, headers=headers, read_body=read_body)


async def _send_response(send: ASGISend, response: FateHTTPResponse) -> None:
    headers = [
        (name.encode("latin-1"), value.encode("latin-1"))
        for name, value in response.headers.items()
    ]
    await send(
        {
            "type": "http.response.start",
            "status": response.status,
            "headers": headers,
        }
    )
    await send({"type": "http.response.body", "body": response.body, "more_body": False})


async def _send_sse(send: ASGISend, response: FateSSEResponse) -> None:
    headers = [
        (name.encode("latin-1"), value.encode("latin-1"))
        for name, value in response.headers.items()
    ]
    await send(
        {
            "type": "http.response.start",
            "status": response.status,
            "headers": headers,
        }
    )
    try:
        async for frame in response.frames:
            await send({"type": "http.response.body", "body": frame, "more_body": True})
    finally:
        if response.on_close is not None:
            import contextlib

            with contextlib.suppress(Exception):
                await response.on_close()
    await send({"type": "http.response.body", "body": b"", "more_body": False})


async def _send_error(send: ASGISend, status: int, body: bytes) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"text/plain; charset=utf-8")],
        }
    )
    await send({"type": "http.response.body", "body": body, "more_body": False})


__all__ = ["fate_asgi_app"]
