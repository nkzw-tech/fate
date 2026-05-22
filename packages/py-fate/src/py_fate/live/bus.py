"""LiveEventBus abstract base.

This is the pluggable layer that the SSE handler reads from. The in-memory
implementation is in `memory.py`; a Redis/NATS implementation can replace it
without touching the rest of the server.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass(slots=True)
class LiveSourceEvent:
    """Event produced for a `subscribe` (entity) subscription."""

    id: str | int
    type: Literal["update", "delete"] = "update"
    data: Any = None
    changed: list[str] | None = None
    event_id: str | None = None


@dataclass(slots=True)
class LiveConnectionSourceEvent:
    """Event produced for a `subscribeConnection` subscription."""

    type: Literal[
        "appendEdge",
        "appendNode",
        "deleteEdge",
        "insertEdgeAfter",
        "insertEdgeBefore",
        "prependEdge",
        "prependNode",
        "invalidate",
    ]
    id: str | int | None = None
    node: Any = None
    node_type: str | None = None
    cursor: str | None = None
    target_cursor: str | None = None
    event_id: str | None = None


@dataclass(slots=True)
class ConnectionTarget:
    procedure: str
    args: dict[str, Any] | None = None


@dataclass(slots=True)
class SubscribeOptions:
    last_event_id: str | None = None


@dataclass(slots=True)
class _ConnectionEvent:
    target: ConnectionTarget
    event: LiveConnectionSourceEvent = field(default_factory=lambda: LiveConnectionSourceEvent(type="invalidate"))


class LiveEventBus(ABC):
    """Pluggable event bus for live subscriptions."""

    @abstractmethod
    async def emit(
        self,
        type_name: str,
        entity_id: str | int,
        *,
        data: Any = None,
        changed: list[str] | None = None,
        event_id: str | None = None,
        event_type: Literal["update", "delete"] = "update",
    ) -> None: ...

    @abstractmethod
    async def delete(
        self,
        type_name: str,
        entity_id: str | int,
        *,
        event_id: str | None = None,
    ) -> None: ...

    @abstractmethod
    async def emit_connection(
        self,
        procedure: str,
        event: LiveConnectionSourceEvent,
        *,
        args: dict[str, Any] | None = None,
    ) -> None: ...

    @abstractmethod
    def subscribe(
        self,
        type_name: str,
        entity_id: str | int,
        *,
        options: SubscribeOptions | None = None,
    ) -> AsyncIterator[LiveSourceEvent]: ...

    @abstractmethod
    def subscribe_connection(
        self,
        target: ConnectionTarget,
        *,
        options: SubscribeOptions | None = None,
    ) -> AsyncIterator[LiveConnectionSourceEvent]: ...


__all__ = [
    "ConnectionTarget",
    "LiveConnectionSourceEvent",
    "LiveEventBus",
    "LiveSourceEvent",
    "SubscribeOptions",
]
