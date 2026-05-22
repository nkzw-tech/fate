"""Source adapter interface.

A source adapter is the bridge between fate's data views and a user's storage
layer. fate calls into the adapter to materialize entities for `byId` and list
operations, plus to follow relations declared in DataViews.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any, Generic, cast

from .connection import resolve_connection
from .data_view import DataView, EntityT, ListField, as_view
from .protocol import FateConnectionResult, FateRequestError
from .selection import has_path, subselect


@dataclass(slots=True)
class ByIdRequest(Generic[EntityT]):
    """A typed `byId` request. The `EntityT` parameter flows back to the caller
    as the row type returned by `SourceAdapter.resolve_by_ids`.
    """

    ctx: Any
    type: str
    ids: list[str | int]
    select: list[str]


@dataclass(slots=True)
class ConnectionRequest:
    ctx: Any
    procedure: str
    args: dict[str, Any] | None
    select: list[str]


class SourceAdapter(ABC):
    """Pluggable storage backend.

    Implementations resolve entities for `byId` and lists. They also expose a
    registry of DataViews so the executor can follow relations.
    """

    @abstractmethod
    async def resolve_by_ids(
        self, request: ByIdRequest[EntityT]
    ) -> list[EntityT | None]: ...

    @abstractmethod
    async def resolve_connection(self, request: ConnectionRequest) -> FateConnectionResult: ...

    @abstractmethod
    def view_for(self, type_name: str) -> DataView[Any] | None: ...

    @abstractmethod
    def has_procedure(self, procedure: str) -> bool: ...


FetchAllFn = Callable[[Any, str], Awaitable[Iterable[dict[str, Any]]]]


class DictSourceAdapter(SourceAdapter):
    """In-memory adapter: each entity type is stored as `list[dict]`.

    Useful for tests and examples. Production code should ship its own adapter
    backed by SQL / a real ORM.
    """

    def __init__(
        self,
        *,
        views: dict[str, type[DataView[Any]] | DataView[Any]],
        data: dict[str, list[dict[str, Any]]],
        roots: dict[str, type[DataView[Any]] | DataView[Any] | ListField] | None = None,
    ) -> None:
        self._views: dict[str, DataView[Any]] = {
            name: as_view(v) for name, v in views.items()
        }
        self._data = data
        self._roots: dict[str, DataView[Any] | ListField] = {
            name: (root if isinstance(root, ListField) else as_view(root))
            for name, root in (roots or {}).items()
        }

    def view_for(self, type_name: str) -> DataView[Any] | None:
        return self._views.get(type_name)

    def has_procedure(self, procedure: str) -> bool:
        return procedure in self._roots

    async def resolve_by_ids(
        self, request: ByIdRequest[EntityT]
    ) -> list[EntityT | None]:
        rows = self._data.get(request.type, [])
        index: dict[str, dict[str, Any]] = {str(row["id"]): row for row in rows if "id" in row}
        results: list[EntityT | None] = []
        view = self._views.get(request.type)
        for raw_id in request.ids:
            row = index.get(str(raw_id))
            if row is None:
                results.append(None)
                continue
            if view is None:
                results.append(cast(EntityT, row))
                continue
            materialized = await _materialize(row, view, request.select, request.ctx, self)
            results.append(cast(EntityT, materialized))
        return results

    async def resolve_connection(self, request: ConnectionRequest) -> FateConnectionResult:
        root = self._roots.get(request.procedure)
        if root is None:
            raise FateRequestError("NOT_FOUND", f"No list registered for '{request.procedure}'.")
        maybe_view = root.view if isinstance(root, ListField) else root
        if maybe_view is None:
            raise FateRequestError(
                "BAD_REQUEST",
                f"List '{request.procedure}' is missing a view; "
                "did you forget to pass one to list_field()?",
            )
        view: DataView = maybe_view
        type_name = view.type_name
        rows = list(self._data.get(type_name, []))

        # naive ordering: stable order by id ascending
        rows.sort(key=lambda r: str(r.get("id", "")))

        node_select = subselect(request.select, "items.node")

        async def query(params: Any) -> list[dict[str, Any]]:
            cursor = params.cursor
            if cursor is not None:
                index = next(
                    (i for i, r in enumerate(rows) if str(r.get("id")) == str(cursor)),
                    -1,
                )
                if index < 0:
                    return []
                if params.direction == "forward":
                    start = index + (params.skip or 0)
                    return rows[start : start + params.take]
                else:
                    end = index - (params.skip or 0) + 1
                    start = max(0, end - params.take)
                    return rows[start:end]
            if params.direction == "backward":
                return rows[-params.take :]
            return rows[: params.take]

        async def map_items(ctx: Any, _input: dict[str, Any], items: list[dict[str, Any]]) -> list[Any]:
            return [await _materialize(item, view, node_select, ctx, self) for item in items]

        return await resolve_connection(
            ctx=request.ctx,
            input={"args": request.args},
            query=query,
            map_items=map_items,
            default_size=root.default_size if isinstance(root, ListField) and root.default_size else 20,
        )


async def _materialize(
    item: dict[str, Any],
    view: DataView,
    select: Iterable[str],
    ctx: Any,
    adapter: SourceAdapter,
) -> dict[str, Any]:
    """Materialize a row through a DataView, projecting only the selected fields."""

    from .data_view import ComputedField, ListField, ResolverField  # local import to avoid cycles

    select_list = list(select)
    out: dict[str, Any] = {}
    for name, spec in view.fields.items():
        if not has_path(select_list, name):
            continue
        if spec is True:
            if name in item:
                out[name] = item[name]
            continue
        if isinstance(spec, DataView):
            value = item.get(name)
            if value is None:
                out[name] = None
                continue
            sub_select = subselect(select_list, name)
            if isinstance(value, dict):
                out[name] = await _materialize(value, spec, sub_select, ctx, adapter)
            elif isinstance(value, (str, int)):
                resolved = await adapter.resolve_by_ids(
                    ByIdRequest(ctx=ctx, type=spec.type_name, ids=[value], select=sub_select)
                )
                out[name] = resolved[0]
            else:
                out[name] = value
            continue
        if isinstance(spec, ListField):
            if spec.view is None:
                continue
            list_view = spec.view
            sub_select = subselect(select_list, name)
            value = item.get(name)
            if isinstance(value, list):
                items_out: list[dict[str, Any]] = []
                for idx, child in enumerate(value):
                    if isinstance(child, dict):
                        child_dict = cast(dict[str, Any], child)
                        cursor = str(child_dict.get("id", idx))
                        node = await _materialize(
                            child_dict,
                            list_view,
                            subselect(sub_select, "items.node"),
                            ctx,
                            adapter,
                        )
                    else:
                        cursor = str(idx)
                        node = child
                    items_out.append({"cursor": cursor, "node": node})
                out[name] = {
                    "items": items_out,
                    "pagination": {"hasNext": False, "hasPrevious": False},
                }
            else:
                out[name] = {"items": [], "pagination": {"hasNext": False, "hasPrevious": False}}
            continue
        if isinstance(spec, ResolverField):
            value = spec.resolve(item, ctx, None)
            if hasattr(value, "__await__"):
                value = await value  # type: ignore[assignment]
            out[name] = value
            continue
        if isinstance(spec, ComputedField):
            deps = {k: item.get(k) for k in (spec.select or {})}
            out[name] = spec.resolve(item, deps, ctx, None)
            continue
    return out


__all__ = [
    "ByIdRequest",
    "ConnectionRequest",
    "DictSourceAdapter",
    "SourceAdapter",
]
