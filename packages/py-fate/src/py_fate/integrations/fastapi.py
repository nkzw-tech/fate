"""First-class FastAPI integration.

`fate_router(server)` returns a FastAPI `APIRouter` with the three endpoints
mounted under it. Mount with `app.include_router(router, prefix="/fate")`.

`fastapi` is imported lazily so the core package has no hard FastAPI dependency.
Install with `pip install py-fate[fastapi]`.
"""

# NOTE: Intentionally NOT using `from __future__ import annotations` — FastAPI
# inspects function annotations at runtime to decide how to inject parameters.
# With deferred (stringified) annotations, FastAPI can't resolve `Request` and
# tries to bind it as a query parameter (returning 422).

from typing import Any

from ..http import FateHTTPRequest, FateHTTPResponse, FateSSEResponse
from ..server import FateServer


def fate_router(
    server: FateServer,
    *,
    tags: "list[Any] | None" = None,
) -> Any:
    """Return an APIRouter that serves the fate protocol.

    Mount it under your preferred prefix:

        from fastapi import FastAPI
        from py_fate.integrations.fastapi import fate_router

        app = FastAPI()
        app.include_router(fate_router(fate), prefix="/fate")
    """

    try:
        from fastapi import APIRouter, Request
        from fastapi.responses import Response, StreamingResponse
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "fastapi is required for py_fate.integrations.fastapi — "
            "install with `pip install py-fate[fastapi]`."
        ) from exc

    router = APIRouter(tags=tags or ["fate"])

    async def handle(request: Request) -> Response:
        fate_req = _to_fate_request(request)
        response = await server.handle_request(fate_req, adapter_context=request)
        return Response(
            content=response.body, status_code=response.status, headers=response.headers
        )

    async def handle_live_get(request: Request) -> Response:
        fate_req = _to_fate_request(request)
        result = await server.handle_live_get(fate_req, adapter_context=request)
        if isinstance(result, FateSSEResponse):
            return StreamingResponse(
                result.frames, status_code=result.status, headers=result.headers
            )
        assert isinstance(result, FateHTTPResponse)
        return Response(
            content=result.body, status_code=result.status, headers=result.headers
        )

    async def handle_live_post(request: Request) -> Response:
        fate_req = _to_fate_request(request)
        response = await server.handle_live_post(fate_req, adapter_context=request)
        return Response(
            content=response.body, status_code=response.status, headers=response.headers
        )

    router.add_api_route("", handle, methods=["POST"], include_in_schema=False)
    router.add_api_route("/", handle, methods=["POST"])
    router.add_api_route("/live", handle_live_get, methods=["GET"])
    router.add_api_route("/live", handle_live_post, methods=["POST"])

    return router


def _to_fate_request(request: Any) -> FateHTTPRequest:
    async def read_body() -> bytes:
        return await request.body()

    return FateHTTPRequest(
        method=request.method,
        url=str(request.url),
        headers={k.lower(): v for k, v in request.headers.items()},
        read_body=read_body,
    )


__all__ = ["fate_router"]
