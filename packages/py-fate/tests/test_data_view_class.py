"""Tests for the class-based declarative DataView form."""

from __future__ import annotations

import pytest

from py_fate import (
    ByIdRequest,
    ComputedField,
    DataView,
    DictSourceAdapter,
    ListField,
    ResolverField,
    Scalar,
    as_view,
    computed,
    list_field,
    resolver,
)


def test_type_name_inferred_from_class_name():
    class UserView(DataView):
        id: Scalar
        name: Scalar

    assert UserView.type_name == "User"
    assert set(UserView.fields.keys()) == {"id", "name"}
    assert UserView.fields["id"] is True
    assert UserView.fields["name"] is True


def test_type_name_override():
    class UserView(DataView, type_name="Account"):
        id: Scalar

    assert UserView.type_name == "Account"


def test_non_view_suffix_class_name():
    class Comment(DataView):
        id: Scalar

    assert Comment.type_name == "Comment"


def test_plain_python_annotations_treated_as_scalars():
    class UserView(DataView):
        id: int
        name: str
        active: bool

    assert UserView.fields == {"id": True, "name": True, "active": True}


def test_nested_relation_via_class_annotation():
    class UserView(DataView):
        id: Scalar
        name: Scalar

    class PostView(DataView):
        id: Scalar
        title: Scalar
        author: UserView

    author_spec = PostView.fields["author"]
    assert isinstance(author_spec, DataView)
    assert author_spec.type_name == "User"
    assert set(author_spec.fields.keys()) == {"id", "name"}


def test_list_relation_from_list_generic():
    class CommentView(DataView):
        id: Scalar
        body: Scalar

    class PostView(DataView):
        id: Scalar
        comments: list[CommentView]

    spec = PostView.fields["comments"]
    assert isinstance(spec, ListField)
    assert spec.view is not None
    assert spec.view.type_name == "Comment"


def test_list_field_default_with_config_and_annotation_inferred_view():
    class CommentView(DataView):
        id: Scalar

    class PostView(DataView):
        comments: list[CommentView] = list_field(order_by=[("createdAt", "asc")])

    spec = PostView.fields["comments"]
    assert isinstance(spec, ListField)
    assert spec.view is not None
    assert spec.view.type_name == "Comment"
    assert spec.order_by == [("createdAt", "asc")]


def test_computed_decorator():
    class PostView(DataView):
        id: Scalar

        @computed(select={"authorId": True})
        def is_owner(item, deps, ctx):
            return deps["authorId"] == "u1"

    spec = PostView.fields["is_owner"]
    assert isinstance(spec, ComputedField)
    assert spec.select == {"authorId": True}
    assert spec.resolve({"authorId": "u1"}, {"authorId": "u1"}, None) is True


def test_resolver_decorator_bare():
    class PostView(DataView):
        id: Scalar

        @resolver
        def like_count(item, ctx):
            return 7

    spec = PostView.fields["like_count"]
    assert isinstance(spec, ResolverField)
    assert spec.resolve({}, None) == 7


def test_resolver_decorator_with_args():
    class PostView(DataView):
        id: Scalar

        @resolver(select={"id": True})
        def like_count(item, ctx):
            return 9

    spec = PostView.fields["like_count"]
    assert isinstance(spec, ResolverField)
    assert spec.select == {"id": True}


def test_as_view_is_idempotent():
    class UserView(DataView):
        id: Scalar

    v1 = as_view(UserView)
    v2 = as_view(UserView)
    assert v1 is v2  # cached singleton
    assert as_view(v1) is v1


def test_dict_source_adapter_accepts_class_form_views():
    class UserView(DataView):
        id: Scalar
        name: Scalar

    class PostView(DataView):
        id: Scalar
        title: Scalar
        author: UserView

    adapter = DictSourceAdapter(
        views={"User": UserView, "Post": PostView},
        data={
            "User": [{"id": "u1", "name": "Alice"}],
            "Post": [{"id": "p1", "title": "Hello", "author": "u1"}],
        },
        roots={"posts": list_field(PostView)},
    )

    user_view = adapter.view_for("User")
    assert user_view is not None
    assert user_view.type_name == "User"
    assert adapter.has_procedure("posts")


@pytest.mark.asyncio
async def test_resolve_by_ids_through_class_based_view():
    class UserView(DataView):
        id: Scalar
        name: Scalar

    class PostView(DataView):
        id: Scalar
        title: Scalar
        author: UserView

    adapter = DictSourceAdapter(
        views={"User": UserView, "Post": PostView},
        data={
            "User": [{"id": "u1", "name": "Alice"}],
            "Post": [{"id": "p1", "title": "Hello", "author": "u1"}],
        },
    )

    results = await adapter.resolve_by_ids(
        ByIdRequest(
            ctx=None,
            type="Post",
            ids=["p1"],
            select=["id", "title", "author.id", "author.name"],
        )
    )
    assert results == [
        {
            "id": "p1",
            "title": "Hello",
            "author": {"id": "u1", "name": "Alice"},
        }
    ]


def test_direct_construction_raises():
    import pytest as _pytest

    with _pytest.raises(TypeError, match="not directly constructible"):
        DataView("User", {"id": True})  # type: ignore[call-arg]


@pytest.mark.asyncio
async def test_by_id_classmethod_returns_typed_entities():
    from typing import TypedDict

    class UserEntity(TypedDict):
        id: str
        name: str

    class UserView(DataView[UserEntity]):
        id: Scalar
        name: Scalar

    adapter = DictSourceAdapter(
        views={"User": UserView},
        data={"User": [{"id": "u1", "name": "Alice"}]},
    )

    # The annotation here is a static-type assertion: if `EntityT` does not flow
    # through `DataView[UserEntity].by_id(...)`, ty/pyright will reject this.
    results: list[UserEntity | None] = await UserView.by_id(
        adapter, None, ["u1"], select=["id", "name"]
    )
    assert results == [{"id": "u1", "name": "Alice"}]

    one: UserEntity | None = await UserView.by_id_one(
        adapter, None, "u1", select=["id", "name"]
    )
    assert one == {"id": "u1", "name": "Alice"}


@pytest.mark.asyncio
async def test_by_id_one_classmethod():
    class UserView(DataView):
        id: Scalar
        name: Scalar

    adapter = DictSourceAdapter(
        views={"User": UserView},
        data={"User": [{"id": "u1", "name": "Alice"}]},
    )

    one = await UserView.by_id_one(adapter, None, "u1", select=["id", "name"])
    assert one == {"id": "u1", "name": "Alice"}

    missing = await UserView.by_id_one(adapter, None, "zzz", select=["id"])
    assert missing is None
