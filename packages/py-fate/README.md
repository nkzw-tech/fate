# py-fate

Python server implementation of the [fate](https://fate.technology) wire protocol.

`py-fate` lets you serve a fate React client from a Python backend. The core is
framework-agnostic — bring your own web framework. A first-class **FastAPI**
integration is included; adapters for any ASGI server are a few lines of glue.

## Status

Version 1 of the wire protocol — `byId` / `list` / `query` / `mutation`
operations, batched in a single POST, plus a live SSE stream for
`subscribe` / `subscribeConnection` / `unsubscribe`.

## Install

```bash
pip install py-fate            # core only
pip install py-fate[fastapi]   # with FastAPI adapter
```

## Quick start (FastAPI)

Declare your domain entities (`TypedDict`, Pydantic model, dataclass — anything)
and a `DataView[Entity]` for each. Annotations on the view are the schema;
the `Entity` parameter flows back to the caller from typed accessors:

```python
from typing import TypedDict

from fastapi import FastAPI
from pydantic import BaseModel
from py_fate import (
    DataView,
    DictSourceAdapter,
    MutationDefinition,
    QueryDefinition,
    Scalar,
    computed,
    create_fate_server,
    list_field,
    resolver,
)
from py_fate.integrations.fastapi import fate_router


class UserEntity(TypedDict):
    id: str
    name: str


class PostEntity(TypedDict):
    id: str
    title: str
    authorId: str


class UserView(DataView[UserEntity]):
    id: Scalar
    name: Scalar


class PostView(DataView[PostEntity]):
    id: Scalar
    title: Scalar
    author: UserView                       # nested relation by annotation

    @computed(select={"authorId": True})
    def is_owner(item: PostEntity, deps, ctx) -> bool:
        return deps.get("authorId") == getattr(ctx, "user_id", None)

    @resolver
    async def like_count(item: PostEntity, ctx) -> int:
        return 0  # query your real datastore here


adapter = DictSourceAdapter(
    views={"User": UserView, "Post": PostView},
    data={
        "User": [{"id": "u1", "name": "Alice"}],
        "Post": [{"id": "p1", "title": "Hello", "authorId": "u1"}],
    },
    roots={"posts": list_field(PostView)},
)


class CreatePost(BaseModel):
    title: str


async def create_post(*, ctx, input: CreatePost, select):
    return {"id": "p2", "title": input.title, "authorId": "u1"}


async def viewer(*, ctx, input, select):
    return {"id": "u1", "name": "Alice"}


server = create_fate_server(
    roots={"posts": list_field(PostView)},
    queries={"viewer": QueryDefinition(resolve=viewer)},
    mutations={
        "createPost": MutationDefinition(
            resolve=create_post, type="Post", input=CreatePost
        )
    },
    sources=adapter,
)

app = FastAPI()
app.include_router(fate_router(server), prefix="/fate")
```

Run it (`uvicorn module:app`) and point your fate React client at
`http://localhost:8000/fate` with `createFateClient({ url: '/fate' })`.

### Typed `by_id` access

The view's `Entity` parameter flows through `by_id` / `by_id_one` — handy from
within mutations, resolvers, or anywhere on the server:

```python
users: list[UserEntity | None] = await UserView.by_id(
    adapter, ctx, ["u1", "u2"], select=["id", "name"]
)
alice: UserEntity | None = await UserView.by_id_one(
    adapter, ctx, "u1", select=["id", "name"]
)
```

### Conventions

- `type_name` is inferred from the class name with a trailing ``View`` stripped
  (`PostView` → `"Post"`); override with
  `class PostView(DataView[PostEntity], type_name="Article")`.
- Plain Python annotations (`id: int`, `name: str`) are treated as scalars —
  `Scalar` is just the most explicit spelling.
- `list[OtherView]` annotations are recognized as list relations.
- The `Entity` generic parameter is optional. Omitting it (`class UserView(DataView)`)
  defaults to `Any`, which keeps untyped resolver bodies working.

## Using something other than FastAPI

The core never imports FastAPI. `FateServer.handle_request` /
`handle_live_get` / `handle_live_post` operate on a small
`FateHTTPRequest` / `FateHTTPResponse` value object pair you build from your
framework's request type.

### Generic ASGI (Starlette, Litestar, Quart, …)

```python
from py_fate.integrations.asgi import fate_asgi_app
asgi = fate_asgi_app(server, prefix="/fate")
# Mount under any ASGI host or run directly with uvicorn:
# uvicorn module:asgi --port 8000
```

### Starlette mount

```python
from starlette.applications import Starlette
from starlette.routing import Mount
from py_fate.integrations.asgi import fate_asgi_app

app = Starlette(routes=[Mount("/fate", app=fate_asgi_app(server))])
```

### Hand-rolled adapter (any framework)

```python
from py_fate import FateHTTPRequest

async def my_endpoint(framework_request):
    async def read_body():
        return await framework_request.body()
    fate_req = FateHTTPRequest(
        method=framework_request.method,
        url=str(framework_request.url),
        headers=dict(framework_request.headers),
        read_body=read_body,
    )
    response = await server.handle_request(fate_req)
    return framework.Response(
        content=response.body,
        status_code=response.status,
        headers=response.headers,
    )
```

## Live (SSE)

```python
from py_fate import create_live_event_bus

bus = create_live_event_bus()
server = create_fate_server(..., live=bus)

# Push updates whenever an entity changes:
await bus.emit("Post", post_id, changed=["likes"], event_id=f"post:{post_id}:{now}")
await bus.delete("Post", post_id)
```

The default in-memory bus is single-process; production deployments can
implement a custom `LiveEventBus` backed by Redis / NATS / Kafka without
touching the rest of the server.

## Authentication

Pass a `context` factory to `create_fate_server`:

```python
from py_fate import FateRequestError

async def make_context(*, request, adapter_context):
    auth = request.headers.get("authorization")
    if not auth:
        raise FateRequestError("UNAUTHORIZED", "Missing token.")
    user = await load_user(auth)
    return {"user": user}

server = create_fate_server(..., context=make_context)
```

The returned value is passed as `ctx` to every resolver.

## Development

```bash
uv sync
uv run pytest
uv run ruff check
uv run ty check
```
