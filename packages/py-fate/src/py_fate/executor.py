"""Per-operation dispatch.

Mirrors the executor section of `createFateServer` in
`packages/fate/src/server/http.ts`.
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .data_view import DataView, ListField
from .input import InputSchema, parse_input
from .protocol import (
    FateOperation,
    FateOperationErr,
    FateOperationOk,
    FateOperationResult,
    FateRequestError,
    to_protocol_error,
)
from .source import ByIdRequest, ConnectionRequest, SourceAdapter

if TYPE_CHECKING:  # pragma: no cover
    pass


Resolver = Callable[..., Awaitable[Any] | Any]


@dataclass(slots=True)
class QueryDefinition:
    resolve: Resolver
    type: str | None = None


@dataclass(slots=True)
class ListDefinition:
    resolve: Resolver
    type: str | None = None
    default_size: int | None = None


@dataclass(slots=True)
class MutationDefinition:
    resolve: Resolver
    type: str
    input: InputSchema = None


@dataclass(slots=True)
class ServerRegistry:
    """All the user-registered surfaces the executor dispatches against."""

    queries: dict[str, QueryDefinition] = field(default_factory=dict)
    lists: dict[str, ListDefinition] = field(default_factory=dict)
    mutations: dict[str, MutationDefinition] = field(default_factory=dict)
    roots: dict[str, DataView[Any] | ListField] = field(default_factory=dict)
    sources: SourceAdapter | None = None


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def execute_operation(
    operation: FateOperation,
    ctx: Any,
    registry: ServerRegistry,
) -> FateOperationResult:
    """Execute a single operation and return the matching result envelope."""

    try:
        if operation.kind == "byId":
            return await _execute_by_id(operation, ctx, registry)
        if operation.kind == "list":
            return await _execute_list(operation, ctx, registry)
        if operation.kind == "query":
            return await _execute_query(operation, ctx, registry)
        if operation.kind == "mutation":
            return await _execute_mutation(operation, ctx, registry)
        raise FateRequestError("BAD_REQUEST", f"Unknown operation kind '{operation.kind}'.")
    except BaseException as error:  # noqa: BLE001
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        return FateOperationErr(id=operation.id, error=to_protocol_error(error))


async def _execute_by_id(
    operation: FateOperation, ctx: Any, registry: ServerRegistry
) -> FateOperationResult:
    if not operation.type or operation.ids is None:
        raise FateRequestError("BAD_REQUEST", "byId operations require type and ids.")
    if registry.sources is None:
        raise FateRequestError(
            "NOT_FOUND", f"No source registered for '{operation.type}'."
        )
    view = registry.sources.view_for(operation.type)
    if view is None:
        raise FateRequestError(
            "NOT_FOUND", f"No source registered for '{operation.type}'."
        )
    data = await registry.sources.resolve_by_ids(
        ByIdRequest(
            ctx=ctx, type=operation.type, ids=list(operation.ids), select=list(operation.select)
        )
    )
    return FateOperationOk(id=operation.id, data=data)


async def _execute_list(
    operation: FateOperation, ctx: Any, registry: ServerRegistry
) -> FateOperationResult:
    if not operation.name:
        raise FateRequestError("BAD_REQUEST", "list operations require a name.")

    custom = registry.lists.get(operation.name)
    if custom is not None:
        data = await _maybe_await(
            custom.resolve(
                ctx=ctx,
                input={"args": operation.args},
                select=list(operation.select),
            )
        )
        return FateOperationOk(id=operation.id, data=data)

    root = registry.roots.get(operation.name)
    if root is None:
        raise FateRequestError("NOT_FOUND", f"No list registered for '{operation.name}'.")
    if not isinstance(root, ListField):
        raise FateRequestError(
            "BAD_REQUEST", f"Root '{operation.name}' is not a list."
        )
    if registry.sources is None:
        raise FateRequestError(
            "NOT_FOUND", f"No source registered for '{operation.name}'."
        )

    procedure = root.procedure or operation.name
    data = await registry.sources.resolve_connection(
        ConnectionRequest(
            ctx=ctx, procedure=procedure, args=operation.args, select=list(operation.select)
        )
    )
    return FateOperationOk(id=operation.id, data=data)


async def _execute_query(
    operation: FateOperation, ctx: Any, registry: ServerRegistry
) -> FateOperationResult:
    if not operation.name:
        raise FateRequestError("BAD_REQUEST", "query operations require a name.")

    custom = registry.queries.get(operation.name)
    if custom is None:
        raise FateRequestError("NOT_FOUND", f"No query registered for '{operation.name}'.")

    data = await _maybe_await(
        custom.resolve(
            ctx=ctx,
            input={"args": operation.args},
            select=list(operation.select),
        )
    )
    return FateOperationOk(id=operation.id, data=data)


async def _execute_mutation(
    operation: FateOperation, ctx: Any, registry: ServerRegistry
) -> FateOperationResult:
    if not operation.name:
        raise FateRequestError("BAD_REQUEST", "mutation operations require a name.")

    mutation = registry.mutations.get(operation.name)
    if mutation is None:
        raise FateRequestError("NOT_FOUND", f"No mutation registered for '{operation.name}'.")

    parsed = await parse_input(mutation.input, operation.input)
    data = await _maybe_await(
        mutation.resolve(
            ctx=ctx,
            input=parsed,
            select=list(operation.select),
        )
    )
    return FateOperationOk(id=operation.id, data=data)


__all__ = [
    "ListDefinition",
    "MutationDefinition",
    "QueryDefinition",
    "Resolver",
    "ServerRegistry",
    "execute_operation",
]
