from typing import Any

import httpx
import pytest

from py_fate.data_view import DataView, Scalar
from py_fate.integrations.asgi import fate_asgi_app
from py_fate.server import create_fate_server
from py_fate.source import DictSourceAdapter


def _build_app() -> Any:
    class UserView(DataView):
        id: Scalar
        name: Scalar

    adapter = DictSourceAdapter(
        views={"User": UserView},
        data={"User": [{"id": "u1", "name": "Alice"}]},
    )
    server = create_fate_server(roots={}, sources=adapter)
    return fate_asgi_app(server, prefix="/fate")


@pytest.mark.asyncio
async def test_asgi_byid_round_trip() -> None:
    app = _build_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/fate",
            json={
                "version": 1,
                "operations": [
                    {
                        "id": "1",
                        "kind": "byId",
                        "type": "User",
                        "ids": ["u1"],
                        "select": ["id", "name"],
                    }
                ],
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1
    assert body["results"][0]["data"] == [{"id": "u1", "name": "Alice"}]


@pytest.mark.asyncio
async def test_asgi_unknown_route() -> None:
    app = _build_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/fate/bogus")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_asgi_method_not_allowed() -> None:
    app = _build_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/fate")
    assert response.status_code == 405
