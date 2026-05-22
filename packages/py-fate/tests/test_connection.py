from typing import Any

import pytest

from py_fate.connection import QueryParams, resolve_connection
from py_fate.protocol import FateRequestError


def make_rows(n: int) -> list[dict[str, Any]]:
    return [{"id": str(i), "value": i} for i in range(1, n + 1)]


async def _query(rows: list[dict[str, Any]], params: QueryParams) -> list[dict[str, Any]]:
    cursor = params.cursor
    if cursor is not None:
        idx = next((i for i, r in enumerate(rows) if r["id"] == cursor), -1)
        if idx < 0:
            return []
        if params.direction == "forward":
            start = idx + (params.skip or 0)
            return rows[start : start + params.take]
        end = idx - (params.skip or 0) + 1
        start = max(0, end - params.take)
        return rows[start:end]
    if params.direction == "backward":
        return rows[-params.take :]
    return rows[: params.take]


async def test_forward_first_page_has_next() -> None:
    rows = make_rows(50)

    async def q(p: QueryParams) -> list[dict[str, Any]]:
        return await _query(rows, p)

    result = await resolve_connection(ctx=None, input={"args": {"first": 10}}, query=q)
    assert len(result.items) == 10
    assert result.pagination.hasNext is True
    assert result.pagination.hasPrevious is False
    assert result.pagination.nextCursor == "10"


async def test_forward_with_after_cursor() -> None:
    rows = make_rows(50)

    async def q(p: QueryParams) -> list[dict[str, Any]]:
        return await _query(rows, p)

    result = await resolve_connection(
        ctx=None, input={"args": {"first": 10, "after": "10"}}, query=q
    )
    assert [item.node["id"] for item in result.items] == [str(i) for i in range(11, 21)]
    assert result.pagination.hasPrevious is True
    assert result.pagination.hasNext is True


async def test_backward_last_page() -> None:
    rows = make_rows(50)

    async def q(p: QueryParams) -> list[dict[str, Any]]:
        return await _query(rows, p)

    result = await resolve_connection(ctx=None, input={"args": {"last": 5}}, query=q)
    assert [item.node["id"] for item in result.items] == ["46", "47", "48", "49", "50"]
    assert result.pagination.hasPrevious is True
    assert result.pagination.hasNext is False


async def test_default_page_size() -> None:
    rows = make_rows(50)

    async def q(p: QueryParams) -> list[dict[str, Any]]:
        return await _query(rows, p)

    result = await resolve_connection(ctx=None, input={"args": None}, query=q)
    assert len(result.items) == 20


async def test_rejects_first_and_last() -> None:
    async def q(p: QueryParams) -> list[dict[str, Any]]:
        return []

    with pytest.raises(FateRequestError) as exc:
        await resolve_connection(ctx=None, input={"args": {"first": 5, "last": 5}}, query=q)
    assert exc.value.code == "VALIDATION_ERROR"


async def test_rejects_after_and_before() -> None:
    async def q(p: QueryParams) -> list[dict[str, Any]]:
        return []

    with pytest.raises(FateRequestError) as exc:
        await resolve_connection(
            ctx=None, input={"args": {"after": "1", "before": "9"}}, query=q
        )
    assert exc.value.code == "VALIDATION_ERROR"


async def test_empty_result() -> None:
    async def q(p: QueryParams) -> list[dict[str, Any]]:
        return []

    result = await resolve_connection(ctx=None, input={"args": {"first": 10}}, query=q)
    assert result.items == []
    assert result.pagination.hasNext is False
    assert result.pagination.hasPrevious is False
