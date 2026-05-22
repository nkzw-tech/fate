"""Cursor pagination helpers — direct port of `packages/fate/src/server/connection.ts`."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from .protocol import ConnectionItem, FateConnectionResult, FateRequestError, Pagination

Direction = Literal["forward", "backward"]

CursorValue = str | int
PAGINATION_ARG_KEYS = {"after", "before", "first", "last"}
DEFAULT_PAGE_SIZE = 20


@dataclass(slots=True)
class PaginationArgs:
    after: str | None = None
    before: str | None = None
    first: int | None = None
    last: int | None = None


@dataclass(slots=True)
class QueryParams:
    ctx: Any
    cursor: str | None
    direction: Direction
    input: dict[str, Any]
    skip: int | None
    take: int


QueryFn = Callable[[QueryParams], Awaitable[Sequence[Any]]]
MapFn = Callable[[Any, dict[str, Any], list[Any]], Awaitable[list[Any]]]
GetCursorFn = Callable[[Any], CursorValue]


def _parse_pagination_args(raw: dict[str, Any] | None) -> PaginationArgs:
    if not raw:
        return PaginationArgs()

    args = PaginationArgs()
    if "after" in raw:
        v = raw["after"]
        if v is not None and not isinstance(v, str):
            raise FateRequestError("VALIDATION_ERROR", "'after' must be a string.")
        args.after = v
    if "before" in raw:
        v = raw["before"]
        if v is not None and not isinstance(v, str):
            raise FateRequestError("VALIDATION_ERROR", "'before' must be a string.")
        args.before = v
    if "first" in raw:
        v = raw["first"]
        if v is not None and (not isinstance(v, int) or isinstance(v, bool) or v <= 0):
            raise FateRequestError("VALIDATION_ERROR", "'first' must be a positive integer.")
        args.first = v
    if "last" in raw:
        v = raw["last"]
        if v is not None and (not isinstance(v, int) or isinstance(v, bool) or v <= 0):
            raise FateRequestError("VALIDATION_ERROR", "'last' must be a positive integer.")
        args.last = v

    if args.after is not None and args.before is not None:
        raise FateRequestError(
            "VALIDATION_ERROR",
            "Connection args can't include both 'after' and 'before'.",
        )
    if args.first is not None and args.last is not None:
        raise FateRequestError(
            "VALIDATION_ERROR",
            "Connection args can't include both 'first' and 'last'.",
        )
    return args


def extract_pagination_args(args: dict[str, Any] | None) -> dict[str, Any]:
    if not args:
        return {}
    return {key: args[key] for key in PAGINATION_ARG_KEYS if key in args}


def _default_get_cursor(node: Any) -> CursorValue:
    if isinstance(node, dict):
        if "id" not in node:
            raise FateRequestError(
                "INTERNAL_ERROR",
                "Default cursor requires nodes to have an 'id' field.",
            )
        cursor = node["id"]
    else:
        cursor = getattr(node, "id", None)
        if cursor is None:
            raise FateRequestError(
                "INTERNAL_ERROR",
                "Default cursor requires nodes to have an 'id' attribute.",
            )
    return cursor


async def resolve_connection(
    *,
    ctx: Any,
    input: dict[str, Any],
    query: QueryFn,
    default_size: int = DEFAULT_PAGE_SIZE,
    get_cursor: GetCursorFn = _default_get_cursor,
    map_items: MapFn | None = None,
) -> FateConnectionResult:
    """Resolve a paginated connection.

    Mirrors `resolveConnection` in `packages/fate/src/server/connection.ts`.

    `query` is called with `pageSize + 1` items requested so we can detect a "has more"
    boundary. `skip=1` when a cursor is provided so the cursor row itself is skipped.
    """

    args = _parse_pagination_args(extract_pagination_args(input.get("args")))
    is_backward = args.before is not None or args.last is not None
    cursor = args.before if is_backward else args.after
    direction: Direction = "backward" if is_backward else "forward"
    page_size = args.first if args.first is not None else args.last
    if page_size is None:
        page_size = default_size

    raw_items = list(
        await query(
            QueryParams(
                ctx=ctx,
                cursor=cursor,
                direction=direction,
                input=input,
                skip=1 if cursor else None,
                take=page_size + 1,
            )
        )
    )

    has_more = len(raw_items) > page_size
    if is_backward:
        limited = raw_items[-page_size:] if raw_items else raw_items
    else:
        limited = raw_items[:page_size]

    nodes = await map_items(ctx, input, limited) if map_items else list(limited)

    items: list[ConnectionItem] = [
        ConnectionItem(cursor=str(get_cursor(node)), node=node) for node in nodes
    ]
    first_item = items[0] if items else None
    last_item = items[-1] if items else None

    has_next = bool(cursor) if is_backward else has_more
    has_previous = has_more if is_backward else bool(cursor)

    return FateConnectionResult(
        items=items,
        pagination=Pagination(
            hasNext=has_next,
            hasPrevious=has_previous,
            nextCursor=last_item.cursor if last_item else None,
            previousCursor=(
                first_item.cursor if first_item and (has_previous or is_backward) else None
            ),
        ),
    )


__all__ = [
    "DEFAULT_PAGE_SIZE",
    "Direction",
    "GetCursorFn",
    "MapFn",
    "PaginationArgs",
    "QueryFn",
    "QueryParams",
    "extract_pagination_args",
    "resolve_connection",
]
