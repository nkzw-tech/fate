"""Declarative data view definitions.

Views are declared as `DataView` subclasses. The class generic parameter is the
domain entity type — typed `by_id` access flows it back to the caller:

    from typing import TypedDict

    class UserEntity(TypedDict):
        id: str
        name: str

    class UserView(DataView[UserEntity]):
        id: Scalar
        name: Scalar

    user: UserEntity | None = (await UserView.by_id(adapter, ctx, "u1"))[0]

Relations, list relations, and computed/resolver methods all read naturally:

    class PostView(DataView[PostEntity]):
        id: Scalar
        title: Scalar
        author: UserView                    # nested relation by annotation
        comments: list[CommentView]         # list relation by annotation

        @computed(select={"authorId": True})
        def is_owner(item: PostEntity, deps, ctx) -> bool:
            return deps["authorId"] == ctx.user.id

        @resolver
        async def like_count(item: PostEntity, ctx) -> int:
            return await count_likes(ctx, item["id"])

`type_name` defaults to the class name with a trailing ``View`` stripped
(``PostView`` -> ``"Post"``). Override with ``class PostView(DataView[E], type_name="Article")``.
"""

from __future__ import annotations

import sys
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import (
    TYPE_CHECKING,
    Any,
    ClassVar,
    Generic,
    TypeVar,
    Union,
    cast,
    get_args,
    get_origin,
)

from typing_extensions import TypeVar as TypeVarExt

if TYPE_CHECKING:  # pragma: no cover
    from .source import SourceAdapter

Item = TypeVar("Item")
Result = TypeVar("Result")
Context = TypeVar("Context")

# Entity type parameter for `DataView`. Unparameterized views default to `Any`,
# so existing untyped code keeps working; users who type their entities (with
# `TypedDict`, a Pydantic model, or a dataclass) get those types back from
# `view.by_id(...)` and friends.
EntityT = TypeVarExt("EntityT", default=Any)


class Scalar:
    """Annotation marker for a plain scalar field on a `DataView`.

    Any non-view annotation (``int``, ``str``, ``bool``, …) is also treated as
    a scalar; ``Scalar`` is just the most explicit spelling.
    """

    __slots__ = ()


@dataclass(slots=True)
class ResolverField(Generic[Item, Result, Context]):
    """Field whose value is produced by an async resolver."""

    resolve: Callable[..., Awaitable[Result] | Result]
    authorize: Callable[..., bool] | None = None
    select: dict[str, Any] | Callable[..., dict[str, Any]] | None = None
    kind: str = "resolver"


@dataclass(slots=True)
class ComputedField(Generic[Item, Result, Context]):
    """Field derived from other selected fields on the same entity."""

    resolve: Callable[..., Result]
    select: dict[str, Any] = field(default_factory=dict)
    authorize: Callable[..., bool] | None = None
    kind: str = "computed"


@dataclass(slots=True)
class ListField:
    """A list / connection relation.

    `view` may be `None` only momentarily when constructed via ``list_field()``
    without an explicit view inside a class-based DataView; it is then filled in
    from the surrounding ``list[SomeView]`` annotation before the view is used.
    """

    view: DataView[Any] | None
    order_by: list[tuple[str, str]] | None = None
    procedure: str | None = None
    default_size: int | None = None
    kind: str = "list"


FieldSpec = Union[
    bool,
    "DataView[Any]",
    ListField,
    ResolverField[Any, Any, Any],
    ComputedField[Any, Any, Any],
]


_MISSING: Any = object()


class DataView(Generic[EntityT]):
    """A typed view over a domain entity.

    Subclass to declare a view; the generic parameter is the entity type:

        class UserView(DataView[UserEntity]):
            id: Scalar
            name: Scalar

    `DataView` cannot be instantiated directly — declare a subclass.
    """

    type_name: str
    fields: dict[str, FieldSpec]

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        raise TypeError(
            "DataView is not directly constructible. "
            "Subclass it instead: `class UserView(DataView[UserEntity]): ...`"
        )

    def __init_subclass__(cls, *, type_name: str | None = None, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        cls.type_name = type_name or _infer_type_name(cls.__name__)
        # Capture the defining frame so string-form annotations (e.g. when the
        # caller uses ``from __future__ import annotations``) can be resolved
        # against the surrounding function/class scope.
        try:
            frame = sys._getframe(1)
            globalns: dict[str, Any] | None = frame.f_globals
            localns: dict[str, Any] | None = dict(frame.f_locals)
        except (ValueError, AttributeError):  # pragma: no cover
            globalns = None
            localns = None
        cls.fields = _collect_fields(cls, globalns=globalns, localns=localns)

    # ---------- typed accessors ----------

    @classmethod
    async def by_id(
        cls,
        adapter: SourceAdapter,
        ctx: Any,
        ids: Sequence[str | int],
        select: Sequence[str] | None = None,
    ) -> list[EntityT | None]:
        """Fetch a batch of entities by id through ``adapter``."""

        from .source import ByIdRequest

        request: ByIdRequest[EntityT] = ByIdRequest(
            ctx=ctx,
            type=cls.type_name,
            ids=list(ids),
            select=list(select or []),
        )
        return await adapter.resolve_by_ids(request)

    @classmethod
    async def by_id_one(
        cls,
        adapter: SourceAdapter,
        ctx: Any,
        id: str | int,
        select: Sequence[str] | None = None,
    ) -> EntityT | None:
        """Fetch a single entity by id (convenience over `by_id`)."""

        results = await cls.by_id(adapter, ctx, [id], select)
        return results[0] if results else None

    @classmethod
    def has(cls, name: str) -> bool:
        return name in cls.fields

    @classmethod
    def get(cls, name: str) -> FieldSpec | None:
        return cls.fields.get(name)


# ---------- decorators for class-based views ----------


@dataclass(slots=True)
class _ComputedMarker:
    """Returned by ``@computed(...)``; converted to a ComputedField at collection."""

    resolve: Callable[..., Any]
    select: dict[str, Any]
    authorize: Callable[..., bool] | None


@dataclass(slots=True)
class _ResolverMarker:
    """Returned by ``@resolver`` / ``@resolver(...)``; converted at collection."""

    resolve: Callable[..., Any]
    select: dict[str, Any] | Callable[..., dict[str, Any]] | None
    authorize: Callable[..., bool] | None


def computed(
    *,
    select: dict[str, Any] | None = None,
    authorize: Callable[..., bool] | None = None,
) -> Callable[[Callable[..., Any]], _ComputedMarker]:
    """Decorate a method to declare it as a `ComputedField`.

    `select` lists the source fields whose values are passed in `deps`.
    """

    def deco(fn: Callable[..., Any]) -> _ComputedMarker:
        return _ComputedMarker(resolve=fn, select=select or {}, authorize=authorize)

    return deco


def resolver(
    fn: Callable[..., Any] | None = None,
    *,
    select: dict[str, Any] | Callable[..., dict[str, Any]] | None = None,
    authorize: Callable[..., bool] | None = None,
) -> Any:
    """Decorate a method to declare it as a `ResolverField`.

    Usable bare (``@resolver``) or with arguments (``@resolver(select=...)``).
    """

    def deco(actual: Callable[..., Any]) -> _ResolverMarker:
        return _ResolverMarker(resolve=actual, select=select, authorize=authorize)

    if fn is not None and callable(fn):
        return deco(fn)
    return deco


# ---------- public helpers ----------


def list_field(
    view: DataView[Any] | type[DataView[Any]] | None = None,
    *,
    order_by: list[tuple[str, str]] | None = None,
    procedure: str | None = None,
    default_size: int | None = None,
) -> Any:
    """Build a `ListField`.

    `view` may be a `DataView` subclass (class form) or a materialized
    `DataView` instance. When used as a default value alongside a
    ``list[SomeView]`` annotation, the view may be omitted and will be inferred
    from the annotation.

    Returns `Any` (rather than `ListField`) so the call site can satisfy a
    ``list[SomeView]`` annotation in class-based `DataView` definitions —
    this mirrors `dataclasses.field()`.
    """

    return ListField(
        view=as_view(view) if view is not None else None,
        order_by=order_by,
        procedure=procedure,
        default_size=default_size,
    )


def as_view(spec: Any) -> DataView[Any]:
    """Coerce a `DataView` subclass to a canonical `DataView` instance.

    Idempotent. Raises `TypeError` if `spec` is neither a `DataView` instance
    nor a `DataView` subclass.
    """

    if isinstance(spec, DataView):
        return spec
    if isinstance(spec, type) and issubclass(spec, DataView):
        return _materialize_class_view(spec)
    raise TypeError(
        f"Expected DataView subclass, got {type(spec).__name__}"
    )


# ---------- internal collection logic ----------


def _infer_type_name(class_name: str) -> str:
    if class_name.endswith("View") and len(class_name) > len("View"):
        return class_name[: -len("View")]
    return class_name


def _materialize_class_view(cls: type[DataView[Any]]) -> DataView[Any]:
    """Build (once, cached on the class) a `DataView` instance from a subclass.

    Internal: bypasses `DataView.__init__` (which raises) via `__new__`.
    """

    cached = cls.__dict__.get("__fate_view_instance__")
    if cached is not None:
        return cast("DataView[Any]", cached)
    inst = cast("DataView[Any]", DataView.__new__(cls))
    inst.type_name = cls.type_name
    inst.fields = cls.fields
    setattr(cls, "__fate_view_instance__", inst)  # noqa: B010
    return inst


def _collect_fields(
    cls: type,
    *,
    globalns: dict[str, Any] | None = None,
    localns: dict[str, Any] | None = None,
) -> dict[str, FieldSpec]:
    """Build the `fields` dict for a class-based DataView subclass.

    Inherits parent `DataView`-subclass fields; the child's own annotations and
    decorated methods override them.
    """

    out: dict[str, FieldSpec] = {}

    # Inherit from any parent DataView subclasses (parents first; child wins).
    for base in reversed(cls.__mro__[1:]):
        if base is DataView or base is object or base is Generic:
            continue
        parent_fields = base.__dict__.get("fields")
        if isinstance(parent_fields, dict):
            out.update(parent_fields)

    # Resolution namespace for string-form annotations.
    resolve_globals: dict[str, Any] = dict(globals())
    user_module = sys.modules.get(cls.__module__)
    if user_module is not None:
        resolve_globals.update(vars(user_module))
    if globalns:
        resolve_globals.update(globalns)
    resolve_locals = dict(localns or {})

    own_annotations = getattr(cls, "__annotations__", {}) or {}
    for name, anno in own_annotations.items():
        if name.startswith("_") or name in {"type_name", "fields"}:
            continue
        resolved_anno = _resolve_annotation(anno, resolve_globals, resolve_locals)
        if get_origin(resolved_anno) is ClassVar:
            continue
        default = cls.__dict__.get(name, _MISSING)
        spec = _build_spec(resolved_anno, default)
        if spec is _MISSING:
            continue
        out[name] = _normalize_spec(spec)

    # Methods decorated with @computed / @resolver have no annotation.
    for name, member in cls.__dict__.items():
        if name.startswith("_"):
            continue
        if isinstance(member, _ComputedMarker):
            out[name] = ComputedField(
                resolve=member.resolve,
                select=member.select,
                authorize=member.authorize,
            )
        elif isinstance(member, _ResolverMarker):
            out[name] = ResolverField(
                resolve=member.resolve,
                select=member.select,
                authorize=member.authorize,
            )

    return out


def _resolve_annotation(
    anno: Any, globalns: dict[str, Any], localns: dict[str, Any]
) -> Any:
    if isinstance(anno, str):
        try:
            return eval(anno, globalns, localns)
        except Exception:
            return anno
    return anno


def _build_spec(anno: Any, default: Any) -> FieldSpec | Any:
    # An explicit default wins, with one exception: a `list_field()` whose view
    # is unset falls back to the surrounding `list[SomeView]` annotation.
    if isinstance(default, ListField):
        if default.view is None:
            inferred = _view_from_list_annotation(anno)
            if inferred is not None:
                default.view = inferred
        return default
    if isinstance(default, (ResolverField, ComputedField)):
        return default
    if isinstance(default, _ComputedMarker):
        return ComputedField(
            resolve=default.resolve,
            select=default.select,
            authorize=default.authorize,
        )
    if isinstance(default, _ResolverMarker):
        return ResolverField(
            resolve=default.resolve,
            select=default.select,
            authorize=default.authorize,
        )
    if isinstance(default, DataView):
        return default
    if isinstance(default, type) and issubclass(default, DataView):
        return default

    # No default — derive from annotation.
    if anno is Scalar:
        return True
    if isinstance(anno, DataView):
        return anno
    if isinstance(anno, type) and issubclass(anno, DataView):
        return anno
    inferred = _view_from_list_annotation(anno)
    if inferred is not None:
        return ListField(view=inferred)

    # Anything else (str, int, bool, etc.) is a plain scalar.
    return True


def _view_from_list_annotation(anno: Any) -> DataView[Any] | None:
    if get_origin(anno) is not list:
        return None
    args = get_args(anno)
    if not args:
        return None
    inner = args[0]
    if isinstance(inner, DataView):
        return inner
    if isinstance(inner, type) and issubclass(inner, DataView):
        return _materialize_class_view(inner)
    return None


def _normalize_spec(spec: FieldSpec) -> FieldSpec:
    """Convert any class-form view inside `spec` into a `DataView` instance."""

    if isinstance(spec, type) and issubclass(spec, DataView):
        return _materialize_class_view(spec)
    if isinstance(spec, ListField):
        if isinstance(spec.view, type) and issubclass(spec.view, DataView):
            spec.view = _materialize_class_view(spec.view)
        return spec
    return spec


__all__ = [
    "ComputedField",
    "DataView",
    "EntityT",
    "FieldSpec",
    "ListField",
    "ResolverField",
    "Scalar",
    "as_view",
    "computed",
    "list_field",
    "resolver",
]
