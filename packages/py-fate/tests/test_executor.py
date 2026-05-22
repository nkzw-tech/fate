from typing import Any

from pydantic import BaseModel

from py_fate.data_view import DataView, Scalar, list_field
from py_fate.executor import (
    MutationDefinition,
    QueryDefinition,
    ServerRegistry,
    execute_operation,
)
from py_fate.protocol import FateOperation, FateOperationErr, FateOperationOk
from py_fate.source import DictSourceAdapter


def _registry() -> ServerRegistry:
    class UserView(DataView):
        id: Scalar
        name: Scalar
        secret: Scalar

    class PostView(DataView):
        id: Scalar
        title: Scalar
        author: UserView

    adapter = DictSourceAdapter(
        views={"User": UserView, "Post": PostView},
        data={
            "User": [
                {"id": "u1", "name": "Alice", "secret": "shh"},
                {"id": "u2", "name": "Bob", "secret": "ssh"},
            ],
            "Post": [
                {"id": "p1", "title": "Hello", "author": "u1"},
                {"id": "p2", "title": "World", "author": "u2"},
            ],
        },
        roots={"posts": list_field(PostView)},
    )

    class CreatePostInput(BaseModel):
        title: str

    async def create_post(*, ctx: Any, input: CreatePostInput, select: list[str]) -> dict[str, Any]:
        return {"id": "new", "title": input.title}

    async def viewer(*, ctx: Any, input: dict[str, Any], select: list[str]) -> dict[str, Any]:
        return {"id": "u1", "name": "Alice"}

    return ServerRegistry(
        queries={"viewer": QueryDefinition(resolve=viewer)},
        mutations={
            "createPost": MutationDefinition(
                resolve=create_post, type="Post", input=CreatePostInput
            )
        },
        lists={},
        roots={"posts": list_field(PostView)},
        sources=adapter,
    )


async def test_byid_filters_unselected_fields() -> None:
    reg = _registry()
    op = FateOperation(
        id="1",
        kind="byId",
        type="User",
        ids=["u1"],
        select=["id", "name"],
    )
    result = await execute_operation(op, ctx=None, registry=reg)
    assert isinstance(result, FateOperationOk)
    assert result.data == [{"id": "u1", "name": "Alice"}]


async def test_byid_resolves_relation() -> None:
    reg = _registry()
    op = FateOperation(
        id="1",
        kind="byId",
        type="Post",
        ids=["p1"],
        select=["id", "title", "author.id", "author.name"],
    )
    result = await execute_operation(op, ctx=None, registry=reg)
    assert isinstance(result, FateOperationOk)
    assert result.data == [
        {"id": "p1", "title": "Hello", "author": {"id": "u1", "name": "Alice"}}
    ]


async def test_byid_returns_null_for_missing() -> None:
    reg = _registry()
    op = FateOperation(
        id="1", kind="byId", type="User", ids=["zzz"], select=["id"]
    )
    result = await execute_operation(op, ctx=None, registry=reg)
    assert isinstance(result, FateOperationOk)
    assert result.data == [None]


async def test_byid_unknown_type_returns_error_envelope() -> None:
    reg = _registry()
    op = FateOperation(
        id="1", kind="byId", type="Unknown", ids=["x"], select=["id"]
    )
    result = await execute_operation(op, ctx=None, registry=reg)
    assert isinstance(result, FateOperationErr)
    assert result.error.code == "NOT_FOUND"


async def test_list_returns_connection() -> None:
    reg = _registry()
    op = FateOperation(
        id="1",
        kind="list",
        name="posts",
        select=["items.node.id", "items.node.title", "pagination.hasNext"],
    )
    result = await execute_operation(op, ctx=None, registry=reg)
    assert isinstance(result, FateOperationOk)
    items = result.data.items
    assert [it.node["id"] for it in items] == ["p1", "p2"]


async def test_query_dispatch() -> None:
    reg = _registry()
    op = FateOperation(id="1", kind="query", name="viewer", select=["id", "name"])
    result = await execute_operation(op, ctx=None, registry=reg)
    assert isinstance(result, FateOperationOk)
    assert result.data == {"id": "u1", "name": "Alice"}


async def test_query_not_found() -> None:
    reg = _registry()
    op = FateOperation(id="1", kind="query", name="missing", select=[])
    result = await execute_operation(op, ctx=None, registry=reg)
    assert isinstance(result, FateOperationErr)
    assert result.error.code == "NOT_FOUND"


async def test_mutation_validates_input() -> None:
    reg = _registry()
    op = FateOperation(
        id="1",
        kind="mutation",
        name="createPost",
        select=["id", "title"],
        input={"wrong": "field"},
    )
    result = await execute_operation(op, ctx=None, registry=reg)
    assert isinstance(result, FateOperationErr)
    assert result.error.code == "VALIDATION_ERROR"


async def test_mutation_success() -> None:
    reg = _registry()
    op = FateOperation(
        id="1",
        kind="mutation",
        name="createPost",
        select=["id", "title"],
        input={"title": "Brand new"},
    )
    result = await execute_operation(op, ctx=None, registry=reg)
    assert isinstance(result, FateOperationOk)
    assert result.data == {"id": "new", "title": "Brand new"}


async def test_internal_error_is_sanitized() -> None:
    async def bad(*, ctx: Any, input: Any, select: list[str]) -> Any:
        raise ValueError("super secret crash")

    reg = ServerRegistry(queries={"crash": QueryDefinition(resolve=bad)})
    op = FateOperation(id="1", kind="query", name="crash", select=[])
    result = await execute_operation(op, ctx=None, registry=reg)
    assert isinstance(result, FateOperationErr)
    assert result.error.code == "INTERNAL_ERROR"
    assert "secret" not in result.error.message
