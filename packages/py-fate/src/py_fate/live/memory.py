"""In-memory `LiveEventBus` implementation using asyncio fanout.

Single-process only. Drop-in replacement for production: write another
`LiveEventBus` subclass that backs onto Redis/NATS/Kafka.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import suppress
from typing import Any, Literal

from .bus import (
    ConnectionTarget,
    LiveConnectionSourceEvent,
    LiveEventBus,
    LiveSourceEvent,
    SubscribeOptions,
)
from .topics import live_connection_topic, live_entity_topic, live_global_connection_topic


class _Subscriber:
    __slots__ = ("queue",)

    def __init__(self) -> None:
        self.queue: asyncio.Queue[Any] = asyncio.Queue()


class InMemoryLiveEventBus(LiveEventBus):
    """Default in-process bus.

    Forwards `event_id` to subscribers, but does not replay events after reconnects.
    All operations are synchronous (no asyncio.Lock) — safe because the asyncio
    event loop is single-threaded and we only mutate state from inside it.
    """

    def __init__(self) -> None:
        self._entity_subs: dict[str, set[_Subscriber]] = {}
        self._connection_subs: dict[str, set[_Subscriber]] = {}

    # ---------- emit ----------

    async def emit(
        self,
        type_name: str,
        entity_id: str | int,
        *,
        data: Any = None,
        changed: list[str] | None = None,
        event_id: str | None = None,
        event_type: Literal["update", "delete"] = "update",
    ) -> None:
        event = LiveSourceEvent(
            id=entity_id,
            type=event_type,
            data=data,
            changed=list(changed) if changed else None,
            event_id=event_id,
        )
        topic = live_entity_topic(type_name, entity_id)
        self._publish(self._entity_subs, topic, event)

    async def delete(
        self,
        type_name: str,
        entity_id: str | int,
        *,
        event_id: str | None = None,
    ) -> None:
        await self.emit(type_name, entity_id, event_id=event_id, event_type="delete")

    async def emit_connection(
        self,
        procedure: str,
        event: LiveConnectionSourceEvent,
        *,
        args: dict[str, Any] | None = None,
    ) -> None:
        scoped = live_connection_topic(procedure, args)
        wildcard = live_global_connection_topic(procedure)
        self._publish(self._connection_subs, scoped, event)
        if scoped != wildcard:
            self._publish(self._connection_subs, wildcard, event)

    def _publish(
        self, subs_map: dict[str, set[_Subscriber]], topic: str, payload: Any
    ) -> None:
        for sub in list(subs_map.get(topic, ())):
            sub.queue.put_nowait(payload)

    # ---------- subscribe ----------

    def _add_sub(self, subs_map: dict[str, set[_Subscriber]], topic: str) -> _Subscriber:
        sub = _Subscriber()
        subs_map.setdefault(topic, set()).add(sub)
        return sub

    def _remove_sub(
        self, subs_map: dict[str, set[_Subscriber]], topic: str, sub: _Subscriber
    ) -> None:
        bucket = subs_map.get(topic)
        if bucket is not None:
            bucket.discard(sub)
            if not bucket:
                subs_map.pop(topic, None)

    def subscribe(
        self,
        type_name: str,
        entity_id: str | int,
        *,
        options: SubscribeOptions | None = None,
    ) -> AsyncIterator[LiveSourceEvent]:
        del options  # in-memory bus has no replay buffer
        topic = live_entity_topic(type_name, entity_id)
        sub = self._add_sub(self._entity_subs, topic)
        return self._iter(self._entity_subs, topic, sub)

    def subscribe_connection(
        self,
        target: ConnectionTarget,
        *,
        options: SubscribeOptions | None = None,
    ) -> AsyncIterator[LiveConnectionSourceEvent]:
        del options
        topic = live_connection_topic(target.procedure, target.args)
        sub = self._add_sub(self._connection_subs, topic)
        return self._iter(self._connection_subs, topic, sub)

    async def _iter(
        self,
        subs_map: dict[str, set[_Subscriber]],
        topic: str,
        sub: _Subscriber,
    ) -> AsyncIterator[Any]:
        try:
            while True:
                yield await sub.queue.get()
        finally:
            with suppress(Exception):
                self._remove_sub(subs_map, topic, sub)


def create_live_event_bus() -> InMemoryLiveEventBus:
    return InMemoryLiveEventBus()


__all__ = ["InMemoryLiveEventBus", "create_live_event_bus"]
