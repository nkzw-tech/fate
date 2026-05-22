from py_fate.selection import (
    filter_by_paths,
    has_path,
    parse_paths,
    paths_intersect,
    subselect,
    tree_to_paths,
)


def test_parse_paths_basic() -> None:
    tree = parse_paths(["id", "title"])
    assert tree == {"id": True, "title": True}


def test_parse_paths_nested() -> None:
    tree = parse_paths(["id", "author.id", "author.name"])
    assert tree == {"id": True, "author": {"id": True, "name": True}}


def test_tree_round_trip() -> None:
    paths = ["id", "author.id", "author.name", "comments.items.node.id"]
    tree = parse_paths(paths)
    round_tripped = sorted(tree_to_paths(tree))
    assert round_tripped == sorted(paths)


def test_subselect_strips_prefix() -> None:
    paths = ["id", "author.id", "author.name", "title"]
    assert sorted(subselect(paths, "author")) == ["id", "name"]


def test_has_path() -> None:
    paths = ["id", "author.id"]
    assert has_path(paths, "id")
    assert has_path(paths, "author")
    assert not has_path(paths, "title")


def test_paths_intersect() -> None:
    assert paths_intersect("a", "a")
    assert paths_intersect("a.b", "a")
    assert paths_intersect("a", "a.b")
    assert not paths_intersect("a", "b")
    assert not paths_intersect("ab", "a")


def test_filter_by_paths_dict() -> None:
    value = {"id": 1, "title": "t", "secret": "s", "author": {"id": 9, "password": "p"}}
    filtered = filter_by_paths(value, ["id", "title", "author.id"])
    assert filtered == {"id": 1, "title": "t", "author": {"id": 9}}


def test_filter_by_paths_list_of_dicts() -> None:
    value = [{"id": 1, "x": "a"}, {"id": 2, "x": "b"}]
    assert filter_by_paths(value, ["id"]) == [{"id": 1}, {"id": 2}]
