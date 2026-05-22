import json
from typing import Any

from py_fate.data_view import DataView, Scalar
from py_fate.executor import QueryDefinition
from py_fate.http import FateHTTPRequest
from py_fate.server import create_fate_server
from py_fate.source import DictSourceAdapter


def _make_request(method: str, url: str, body: bytes = b"") -> FateHTTPRequest:
    async def read_body() -> bytes:
        return body

    return FateHTTPRequest(
        method=method, url=url, headers={"content-type": "application/json"}, read_body=read_body
    )


def _server() -> Any:
    class UserView(DataView):
        id: Scalar
        name: Scalar

    adapter = DictSourceAdapter(
        views={"User": UserView},
        data={"User": [{"id": "u1", "name": "Alice"}]},
        roots={},
    )

    async def viewer(*, ctx: Any, input: Any, select: list[str]) -> dict[str, Any]:
        return {"id": "u1", "name": "Alice"}

    return create_fate_server(
        queries={"viewer": QueryDefinition(resolve=viewer)},
        roots={},
        sources=adapter,
    )


async def test_handle_request_byid() -> None:
    server = _server()
    payload = {
        "version": 1,
        "operations": [
            {"id": "1", "kind": "byId", "type": "User", "ids": ["u1"], "select": ["id", "name"]}
        ],
    }
    req = _make_request("POST", "/fate", json.dumps(payload).encode("utf-8"))
    res = await server.handle_request(req)
    assert res.status == 200
    body = json.loads(res.body)
    assert body["version"] == 1
    assert body["results"][0]["ok"] is True
    assert body["results"][0]["data"] == [{"id": "u1", "name": "Alice"}]
    assert res.headers["content-type"] == "application/json; charset=utf-8"


async def test_handle_request_invalid_json_returns_envelope() -> None:
    server = _server()
    req = _make_request("POST", "/fate", b"{not json")
    res = await server.handle_request(req)
    assert res.status == 400
    body = json.loads(res.body)
    assert body["results"][0]["id"] == "request"
    assert body["results"][0]["ok"] is False
    assert body["results"][0]["error"]["code"] == "BAD_REQUEST"


async def test_handle_request_invalid_protocol_request() -> None:
    server = _server()
    req = _make_request("POST", "/fate", json.dumps({"version": 2}).encode("utf-8"))
    res = await server.handle_request(req)
    assert res.status == 400
    body = json.loads(res.body)
    assert body["results"][0]["error"]["code"] == "BAD_REQUEST"


async def test_handle_request_batches_multiple_operations() -> None:
    server = _server()
    payload = {
        "version": 1,
        "operations": [
            {"id": "a", "kind": "query", "name": "viewer", "select": ["id"]},
            {"id": "b", "kind": "byId", "type": "User", "ids": ["u1"], "select": ["id"]},
        ],
    }
    req = _make_request("POST", "/fate", json.dumps(payload).encode("utf-8"))
    res = await server.handle_request(req)
    body = json.loads(res.body)
    ids = [r["id"] for r in body["results"]]
    assert ids == ["a", "b"]


async def test_handle_live_disabled() -> None:
    server = _server()
    req = _make_request("GET", "/fate/live?connectionId=x")
    res = await server.handle_live_get(req)
    body = json.loads(res.body)
    assert res.status == 404
    assert body["results"][0]["error"]["code"] == "NOT_FOUND"
