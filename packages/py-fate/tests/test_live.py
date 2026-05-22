import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI

from py_fate.data_view import DataView, Scalar
from py_fate.integrations.fastapi import fate_router
from py_fate.live.memory import create_live_event_bus
from py_fate.server import create_fate_server
from py_fate.source import DictSourceAdapter


def _parse_sse(buffer: bytes) -> list[dict[str, str]]:
    """Parse SSE buffer into events. Each event is {id?, event?, data?}."""

    events: list[dict[str, str]] = []
    text = buffer.decode("utf-8")
    for chunk in text.split("\n\n"):
        chunk = chunk.strip("\n")
        if not chunk or chunk.startswith(":"):
            continue
        event: dict[str, str] = {}
        for line in chunk.splitlines():
            if ":" in line:
                name, _, value = line.partition(":")
                event[name.strip()] = value.strip()
        if event:
            events.append(event)
    return events


def _build_app():  # type: ignore[no-untyped-def]
    class UserView(DataView):
        id: Scalar
        name: Scalar

    adapter = DictSourceAdapter(
        views={"User": UserView},
        data={"User": [{"id": "u1", "name": "Alice"}, {"id": "u2", "name": "Bob"}]},
    )
    bus = create_live_event_bus()
    server = create_fate_server(roots={}, sources=adapter, live=bus)
    app = FastAPI()
    app.include_router(fate_router(server), prefix="/fate")
    return app, bus, server


@pytest.mark.asyncio
async def test_live_post_without_get_is_not_found() -> None:
    app, _bus, _server = _build_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/fate/live",
            json={
                "version": 1,
                "connectionId": "missing",
                "operations": [],
            },
        )
    assert response.status_code == 404
    body = response.json()
    assert body["results"][0]["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_live_entity_subscribe_emits_event() -> None:
    app, bus, server = _build_app()

    # Manually register a live connection on the server (skip the SSE GET).
    from py_fate.live.connection import LiveConnection

    outbox: asyncio.Queue[bytes | None] = asyncio.Queue()
    conn = LiveConnection(connection_id="c1", outbox=outbox)
    server._connections.register(conn)  # type: ignore[attr-defined]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        sub_resp = await client.post(
            "/fate/live",
            json={
                "version": 1,
                "connectionId": "c1",
                "operations": [
                    {
                        "id": "s1",
                        "kind": "subscribe",
                        "type": "User",
                        "entityId": "u1",
                        "select": ["id", "name"],
                    }
                ],
            },
        )
    assert sub_resp.status_code == 200
    body = sub_resp.json()
    assert body["results"][0]["ok"] is True

    # Emit an event; the bus should fan it out to the subscription task,
    # which resolves byId and pushes an SSE frame onto the outbox.
    await bus.emit("User", "u1", changed=["name"], event_id="evt-1")

    # Wait for the frame
    frame = await asyncio.wait_for(outbox.get(), timeout=2.0)
    assert frame is not None
    events = _parse_sse(frame)
    assert events[0]["event"] == "next"
    payload = json.loads(events[0]["data"])
    assert payload["kind"] == "next"
    assert payload["event"]["data"] == {"id": "u1", "name": "Alice"}

    # Clean up
    await server._connections.remove("c1")  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_live_unsubscribe_stops_events() -> None:
    app, bus, server = _build_app()
    from py_fate.live.connection import LiveConnection

    outbox: asyncio.Queue[bytes | None] = asyncio.Queue()
    conn = LiveConnection(connection_id="c2", outbox=outbox)
    server._connections.register(conn)  # type: ignore[attr-defined]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post(
            "/fate/live",
            json={
                "version": 1,
                "connectionId": "c2",
                "operations": [
                    {
                        "id": "s1",
                        "kind": "subscribe",
                        "type": "User",
                        "entityId": "u1",
                        "select": ["id"],
                    }
                ],
            },
        )
        await client.post(
            "/fate/live",
            json={
                "version": 1,
                "connectionId": "c2",
                "operations": [{"id": "s1", "kind": "unsubscribe"}],
            },
        )

    # Give the cancellation a moment to settle
    await asyncio.sleep(0.05)
    await bus.emit("User", "u1", event_id="evt-2")
    await asyncio.sleep(0.05)
    assert outbox.empty()

    await server._connections.remove("c2")  # type: ignore[attr-defined]
