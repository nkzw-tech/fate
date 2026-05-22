"""Per-connection live state.

Tracks a single SSE client: outbound message queue, active subscription tasks
keyed by operation id, and an atomic close flag.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class LiveConnection:
    connection_id: str
    outbox: asyncio.Queue[Any]
    subscriptions: dict[str, asyncio.Task[None]] = field(default_factory=dict)
    closed: bool = False
    last_event_ids: dict[str, str] = field(default_factory=dict)
    max_queue_size: int = 1000

    def enqueue(self, frame: Any) -> bool:
        """Push a frame onto the outbox.

        Returns False if the connection's queue is full (caller should close it).
        """

        if self.closed:
            return False
        if self.outbox.qsize() >= self.max_queue_size:
            return False
        self.outbox.put_nowait(frame)
        return True

    def add_subscription(self, op_id: str, task: asyncio.Task[None]) -> None:
        existing = self.subscriptions.pop(op_id, None)
        if existing is not None:
            existing.cancel()
        self.subscriptions[op_id] = task

    def cancel_subscription(self, op_id: str) -> None:
        task = self.subscriptions.pop(op_id, None)
        if task is not None:
            task.cancel()

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        for task in list(self.subscriptions.values()):
            task.cancel()
        for task in list(self.subscriptions.values()):
            with contextlib.suppress(BaseException):
                await task
        self.subscriptions.clear()


class LiveConnectionRegistry:
    """Tracks active live connections by id."""

    def __init__(self) -> None:
        self._connections: dict[str, LiveConnection] = {}

    def register(self, connection: LiveConnection) -> None:
        self._connections[connection.connection_id] = connection

    def get(self, connection_id: str) -> LiveConnection | None:
        return self._connections.get(connection_id)

    async def remove(self, connection_id: str) -> None:
        connection = self._connections.pop(connection_id, None)
        if connection is not None:
            await connection.close()


__all__ = ["LiveConnection", "LiveConnectionRegistry"]
