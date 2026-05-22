"""FateServer — the framework-agnostic core.

`create_fate_server` returns a `FateServer` with three async entry points:
- `handle_request(request)` — POST /<prefix> dispatch
- `handle_live_get(request)` — GET /<prefix>/live SSE stream
- `handle_live_post(request)` — POST /<prefix>/live subscription control
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from .data_view import DataView, ListField, as_view
from .executor import (
    ListDefinition,
    MutationDefinition,
    QueryDefinition,
    ServerRegistry,
    execute_operation,
)
from .http import (
    FateHTTPRequest,
    FateHTTPResponse,
    FateSSEResponse,
    json_response,
)
from .live.bus import (
    ConnectionTarget,
    LiveConnectionSourceEvent,
    LiveEventBus,
    LiveSourceEvent,
    SubscribeOptions,
)
from .live.connection import LiveConnection, LiveConnectionRegistry
from .protocol import (
    FateLiveConnectionDeleteEvent,
    FateLiveConnectionEdgeEvent,
    FateLiveConnectionInvalidateEvent,
    FateLiveConnectionSubscribeOperation,
    FateLiveControlRequest,
    FateLiveDataEvent,
    FateLiveDeleteEvent,
    FateLiveMessage,
    FateLiveMessageConnection,
    FateLiveMessageError,
    FateLiveMessageNext,
    FateLiveSubscribeOperation,
    FateLiveUnsubscribeOperation,
    FateOperationErr,
    FateOperationOk,
    FateProtocolRequest,
    FateProtocolResponse,
    FateRequestError,
    status_from_error_code,
    to_protocol_error,
)
from .selection import filter_by_paths, subselect
from .source import ByIdRequest, SourceAdapter
from .sse import SSE_HEADERS, sse_comment, sse_frame

ContextFactory = Callable[..., Awaitable[Any] | Any]

HEARTBEAT_SECONDS = 25.0


@dataclass(slots=True)
class _ServerConfig:
    queries: Mapping[str, QueryDefinition] | None = None
    lists: Mapping[str, ListDefinition] | None = None
    mutations: Mapping[str, MutationDefinition] | None = None
    roots: Mapping[str, type[DataView[Any]] | DataView[Any] | ListField] | None = None
    sources: SourceAdapter | None = None
    live: LiveEventBus | None = None
    context: ContextFactory | None = None
    max_queue_size: int = 1000


class FateServer:
    """Framework-agnostic fate server.

    Construct one with `create_fate_server(...)` and call `handle_request` /
    `handle_live_get` / `handle_live_post` from your web framework adapter.
    """

    def __init__(self, config: _ServerConfig) -> None:
        normalized_roots: dict[str, DataView[Any] | ListField] = {
            name: (root if isinstance(root, ListField) else as_view(root))
            for name, root in (config.roots or {}).items()
        }
        self._registry = ServerRegistry(
            queries=dict(config.queries or {}),
            lists=dict(config.lists or {}),
            mutations=dict(config.mutations or {}),
            roots=normalized_roots,
            sources=config.sources,
        )
        self._context_factory = config.context
        self._live_bus = config.live
        self._connections = LiveConnectionRegistry()
        self._max_queue_size = config.max_queue_size

    @property
    def live_bus(self) -> LiveEventBus | None:
        return self._live_bus

    @property
    def registry(self) -> ServerRegistry:
        return self._registry

    # ---------- context ----------

    async def _build_context(self, request: FateHTTPRequest, adapter_context: Any) -> Any:
        if self._context_factory is None:
            return None
        result = self._context_factory(request=request, adapter_context=adapter_context)
        if inspect.isawaitable(result):
            result = await result
        return result

    # ---------- POST /<prefix> ----------

    async def handle_request(
        self, request: FateHTTPRequest, *, adapter_context: Any = None
    ) -> FateHTTPResponse:
        try:
            raw = await request.json()
            try:
                payload = FateProtocolRequest.model_validate(raw)
            except ValidationError as exc:
                raise FateRequestError(
                    "BAD_REQUEST", "Invalid Fate protocol request.", issues=exc.errors(include_url=False)
                ) from exc

            ctx = await self._build_context(request, adapter_context)
            results = await asyncio.gather(
                *(execute_operation(op, ctx, self._registry) for op in payload.operations)
            )
            response = FateProtocolResponse(results=results)
            return json_response(response.model_dump(exclude_none=True))
        except FateRequestError as exc:
            return _error_envelope(exc, operation_id="request")
        except json.JSONDecodeError as exc:
            return _error_envelope(
                FateRequestError("BAD_REQUEST", "Invalid JSON body.", issues=str(exc)),
                operation_id="request",
            )
        except Exception:  # noqa: BLE001
            return _error_envelope(
                FateRequestError("INTERNAL_ERROR", "Internal server error."),
                operation_id="request",
            )

    # ---------- GET /<prefix>/live ----------

    async def handle_live_get(
        self, request: FateHTTPRequest, *, adapter_context: Any = None
    ) -> FateSSEResponse | FateHTTPResponse:
        if self._live_bus is None:
            return _error_envelope(
                FateRequestError("NOT_FOUND", "Live views are not enabled."),
                operation_id="live",
            )

        connection_id = _query_param(request.url, "connectionId")
        if not connection_id:
            return _error_envelope(
                FateRequestError("BAD_REQUEST", "Invalid Fate live request."),
                operation_id="live",
            )

        outbox: asyncio.Queue[bytes | None] = asyncio.Queue()
        connection = LiveConnection(
            connection_id=connection_id,
            outbox=outbox,
            max_queue_size=self._max_queue_size,
        )
        self._connections.register(connection)

        async def stream() -> AsyncIterator[bytes]:
            yield sse_comment("connected")
            heartbeat = asyncio.create_task(_heartbeat(outbox))
            try:
                while True:
                    frame = await outbox.get()
                    if frame is None:
                        break
                    yield frame
            finally:
                heartbeat.cancel()
                with contextlib.suppress(BaseException):
                    await heartbeat
                await self._connections.remove(connection_id)

        async def on_close() -> None:
            await self._connections.remove(connection_id)

        return FateSSEResponse(
            status=200, headers=dict(SSE_HEADERS), frames=stream(), on_close=on_close
        )

    # ---------- POST /<prefix>/live ----------

    async def handle_live_post(
        self, request: FateHTTPRequest, *, adapter_context: Any = None
    ) -> FateHTTPResponse:
        if self._live_bus is None:
            return _error_envelope(
                FateRequestError("NOT_FOUND", "Live views are not enabled."),
                operation_id="live",
            )

        try:
            raw = await request.json()
            try:
                payload = FateLiveControlRequest.model_validate(raw)
            except ValidationError as exc:
                raise FateRequestError(
                    "BAD_REQUEST",
                    "Invalid Fate live request.",
                    issues=exc.errors(include_url=False),
                ) from exc

            connection = self._connections.get(payload.connectionId)
            if connection is None or connection.closed:
                raise FateRequestError("NOT_FOUND", "Live connection not found.")

            ctx = await self._build_context(request, adapter_context)
            results: list[FateOperationOk | FateOperationErr] = []
            for op in payload.operations:
                try:
                    self._apply_control_op(connection, op, ctx)
                    results.append(FateOperationOk(id=op.id, data=None))
                except BaseException as exc:  # noqa: BLE001
                    if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                        raise
                    results.append(FateOperationErr(id=op.id, error=to_protocol_error(exc)))
            response = FateProtocolResponse(results=results)
            return json_response(response.model_dump(exclude_none=True))
        except FateRequestError as exc:
            return _error_envelope(exc, operation_id="live")
        except Exception:  # noqa: BLE001
            return _error_envelope(
                FateRequestError("INTERNAL_ERROR", "Internal server error."),
                operation_id="live",
            )

    # ---------- subscriptions ----------

    def _apply_control_op(
        self,
        connection: LiveConnection,
        op: FateLiveSubscribeOperation
        | FateLiveConnectionSubscribeOperation
        | FateLiveUnsubscribeOperation,
        ctx: Any,
    ) -> None:
        if isinstance(op, FateLiveUnsubscribeOperation):
            connection.cancel_subscription(op.id)
            return

        if self._live_bus is None:  # pragma: no cover — guarded above
            raise FateRequestError("NOT_FOUND", "Live views are not enabled.")

        if isinstance(op, FateLiveSubscribeOperation):
            iterator = self._live_bus.subscribe(
                op.type,
                op.entityId,
                options=SubscribeOptions(last_event_id=op.lastEventId),
            )
            task = asyncio.create_task(
                self._run_entity_subscription(connection, op, ctx, iterator),
                name=f"fate-live-sub-{op.id}",
            )
            connection.add_subscription(op.id, task)
            return

        # FateLiveConnectionSubscribeOperation
        target = ConnectionTarget(procedure=op.procedure, args=op.args)
        iterator = self._live_bus.subscribe_connection(
            target, options=SubscribeOptions(last_event_id=op.lastEventId)
        )
        task = asyncio.create_task(
            self._run_connection_subscription(connection, op, ctx, iterator),
            name=f"fate-live-conn-{op.id}",
        )
        connection.add_subscription(op.id, task)

    async def _run_entity_subscription(
        self,
        connection: LiveConnection,
        op: FateLiveSubscribeOperation,
        ctx: Any,
        iterator: AsyncIterator[LiveSourceEvent],
    ) -> None:
        assert self._live_bus is not None
        try:
            async for event in iterator:
                message = await self._build_entity_message(op, event, ctx)
                if not connection.enqueue(sse_frame(message, event_id=event.event_id)):
                    await self._close_overflow(connection)
                    return
                if event.event_id:
                    connection.last_event_ids[op.id] = event.event_id
        except asyncio.CancelledError:
            return
        except BaseException as exc:  # noqa: BLE001
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            self._enqueue_error(connection, op.id, exc)

    async def _run_connection_subscription(
        self,
        connection: LiveConnection,
        op: FateLiveConnectionSubscribeOperation,
        ctx: Any,
        iterator: AsyncIterator[LiveConnectionSourceEvent],
    ) -> None:
        assert self._live_bus is not None
        try:
            async for event in iterator:
                message = await self._build_connection_message(op, event, ctx)
                if not connection.enqueue(sse_frame(message, event_id=event.event_id)):
                    await self._close_overflow(connection)
                    return
                if event.event_id:
                    connection.last_event_ids[op.id] = event.event_id
        except asyncio.CancelledError:
            return
        except BaseException as exc:  # noqa: BLE001
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            self._enqueue_error(connection, op.id, exc)

    async def _build_entity_message(
        self,
        op: FateLiveSubscribeOperation,
        event: LiveSourceEvent,
        ctx: Any,
    ) -> FateLiveMessage:
        if event.type == "delete":
            return FateLiveMessageNext(
                id=op.id, event=FateLiveDeleteEvent(delete=True, id=event.id)
            )
        data = event.data
        if data is None and self._registry.sources is not None:
            try:
                fetched = await self._registry.sources.resolve_by_ids(
                    ByIdRequest(
                        ctx=ctx,
                        type=op.type,
                        ids=[event.id],
                        select=list(op.select),
                    )
                )
                data = fetched[0] if fetched else None
            except Exception:  # noqa: BLE001
                data = None
        if data is None:
            return FateLiveMessageNext(
                id=op.id, event=FateLiveDeleteEvent(delete=True, id=event.id)
            )
        filtered = filter_by_paths(data, op.select)
        return FateLiveMessageNext(
            id=op.id,
            event=FateLiveDataEvent(data=filtered, select=event.changed),
        )

    async def _build_connection_message(
        self,
        op: FateLiveConnectionSubscribeOperation,
        event: LiveConnectionSourceEvent,
        ctx: Any,
    ) -> FateLiveMessage:
        if event.type == "invalidate":
            return FateLiveMessageConnection(
                id=op.id, event=FateLiveConnectionInvalidateEvent()
            )
        if event.type == "deleteEdge":
            return FateLiveMessageConnection(
                id=op.id,
                event=FateLiveConnectionDeleteEvent(
                    id=event.id if event.id is not None else "",
                    nodeType=event.node_type or op.type,
                ),
            )

        node = event.node
        if node is None and event.id is not None and self._registry.sources is not None:
            node_select = subselect(op.select, "items.node")
            fetched = await self._registry.sources.resolve_by_ids(
                ByIdRequest(
                    ctx=ctx,
                    type=event.node_type or op.type,
                    ids=[event.id],
                    select=node_select,
                )
            )
            node = fetched[0] if fetched else None
        elif node is not None:
            node_select = subselect(op.select, "items.node")
            node = filter_by_paths(node, node_select)

        return FateLiveMessageConnection(
            id=op.id,
            event=FateLiveConnectionEdgeEvent(
                type=event.type,
                nodeType=event.node_type or op.type,
                edge={"cursor": event.cursor, "node": node},
                targetCursor=event.target_cursor,
            ),
        )

    def _enqueue_error(
        self, connection: LiveConnection, op_id: str, error: BaseException
    ) -> None:
        msg = FateLiveMessageError(id=op_id, error=to_protocol_error(error))
        connection.enqueue(sse_frame(msg))

    async def _close_overflow(self, connection: LiveConnection) -> None:
        # signal stream end + drop the connection
        connection.outbox.put_nowait(None)  # type: ignore[arg-type]
        await self._connections.remove(connection.connection_id)


def create_fate_server(
    *,
    queries: Mapping[str, QueryDefinition] | None = None,
    lists: Mapping[str, ListDefinition] | None = None,
    mutations: Mapping[str, MutationDefinition] | None = None,
    roots: Mapping[str, type[DataView[Any]] | DataView[Any] | ListField] | None = None,
    sources: SourceAdapter | None = None,
    live: LiveEventBus | None = None,
    context: ContextFactory | None = None,
    max_queue_size: int = 1000,
) -> FateServer:
    return FateServer(
        _ServerConfig(
            queries=queries,
            lists=lists,
            mutations=mutations,
            roots=roots,
            sources=sources,
            live=live,
            context=context,
            max_queue_size=max_queue_size,
        )
    )


# ---------- helpers ----------


def _error_envelope(exc: FateRequestError, *, operation_id: str) -> FateHTTPResponse:
    response = FateProtocolResponse(
        results=[FateOperationErr(id=operation_id, error=to_protocol_error(exc))]
    )
    return json_response(
        response.model_dump(exclude_none=True),
        status=status_from_error_code(exc.code),
    )


def _query_param(url: str, key: str) -> str | None:
    from urllib.parse import parse_qs, urlparse

    parsed = urlparse(url)
    values = parse_qs(parsed.query).get(key)
    return values[0] if values else None


async def _heartbeat(outbox: asyncio.Queue[bytes | None]) -> None:
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            outbox.put_nowait(sse_comment("heartbeat"))
    except asyncio.CancelledError:
        return


def new_connection_id() -> str:
    """Helper for tests / examples to generate UUID v4 connection ids."""

    return str(uuid.uuid4())


__all__ = [
    "FateServer",
    "create_fate_server",
    "new_connection_id",
]
