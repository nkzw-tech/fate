from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from pydantic import BaseModel

from py_fate.data_view import DataView, Scalar, list_field
from py_fate.executor import MutationDefinition, QueryDefinition
from py_fate.integrations.fastapi import fate_router
from py_fate.server import create_fate_server
from py_fate.source import DictSourceAdapter


def _build_app() -> FastAPI:
    class UserView(DataView):
        id: Scalar
        name: Scalar

    class PostView(DataView):
        id: Scalar
        title: Scalar
        author: UserView

    adapter = DictSourceAdapter(
        views={"User": UserView, "Post": PostView},
        data={
            "User": [{"id": "u1", "name": "Alice"}],
            "Post": [
                {"id": "p1", "title": "Hello", "author": "u1"},
                {"id": "p2", "title": "World", "author": "u1"},
            ],
        },
        roots={"posts": list_field(PostView)},
    )

    class CreatePost(BaseModel):
        title: str

    async def create_post(*, ctx: Any, input: CreatePost, select: list[str]) -> dict[str, Any]:
        return {"id": "p3", "title": input.title}

    async def viewer(*, ctx: Any, input: dict[str, Any], select: list[str]) -> dict[str, Any]:
        return {"id": "u1", "name": "Alice"}

    server = create_fate_server(
        queries={"viewer": QueryDefinition(resolve=viewer)},
        mutations={
            "createPost": MutationDefinition(
                resolve=create_post, type="Post", input=CreatePost
            )
        },
        roots={"posts": list_field(PostView)},
        sources=adapter,
    )

    app = FastAPI()
    app.include_router(fate_router(server), prefix="/fate")
    return app


@pytest.mark.asyncio
async def test_fastapi_batched_operations() -> None:
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
                        "type": "Post",
                        "ids": ["p1"],
                        "select": ["id", "title", "author.id", "author.name"],
                    },
                    {
                        "id": "2",
                        "kind": "list",
                        "name": "posts",
                        "select": ["items.node.id", "items.node.title", "pagination.hasNext"],
                    },
                    {
                        "id": "3",
                        "kind": "query",
                        "name": "viewer",
                        "select": ["id", "name"],
                    },
                    {
                        "id": "4",
                        "kind": "mutation",
                        "name": "createPost",
                        "select": ["id", "title"],
                        "input": {"title": "New!"},
                    },
                ],
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1
    results_by_id = {r["id"]: r for r in body["results"]}
    assert results_by_id["1"]["ok"] is True
    assert results_by_id["1"]["data"] == [
        {"id": "p1", "title": "Hello", "author": {"id": "u1", "name": "Alice"}}
    ]
    assert results_by_id["2"]["ok"] is True
    posts = results_by_id["2"]["data"]
    assert [item["node"]["id"] for item in posts["items"]] == ["p1", "p2"]
    assert posts["pagination"]["hasNext"] is False
    assert results_by_id["3"]["ok"] is True
    assert results_by_id["4"]["ok"] is True
    assert results_by_id["4"]["data"] == {"id": "p3", "title": "New!"}


@pytest.mark.asyncio
async def test_fastapi_mutation_validation_error() -> None:
    app = _build_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/fate",
            json={
                "version": 1,
                "operations": [
                    {
                        "id": "x",
                        "kind": "mutation",
                        "name": "createPost",
                        "select": ["id"],
                        "input": {"missing": "fields"},
                    }
                ],
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["results"][0]["ok"] is False
    assert body["results"][0]["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_fastapi_content_type_header() -> None:
    app = _build_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/fate",
            json={
                "version": 1,
                "operations": [
                    {"id": "1", "kind": "query", "name": "viewer", "select": ["id"]}
                ],
            },
        )
    assert "application/json" in response.headers["content-type"]
