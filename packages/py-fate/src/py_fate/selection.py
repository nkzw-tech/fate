"""Helpers for parsing and scoping flat dotted selection paths.

The wire protocol sends `select: string[]` where each entry is a dotted path:
    ["id", "title", "author.id", "author.name", "comments.items.node.id"]

These helpers convert that to a nested tree and let callers scope it to a relation.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Union, cast

SelectionTree = dict[str, Union[bool, "SelectionTree"]]


def parse_paths(paths: Iterable[str]) -> SelectionTree:
    """Convert flat dotted paths into a nested selection tree.

    Leaves are True; inner nodes are SelectionTree.
    """

    tree: SelectionTree = {}
    for raw in paths:
        if not raw:
            continue
        parts = raw.split(".")
        node: SelectionTree = tree
        for part in parts[:-1]:
            existing = node.get(part)
            if not isinstance(existing, dict):
                existing = {}
                node[part] = existing
            node = existing
        last = parts[-1]
        if last not in node:
            node[last] = True
    return tree


def tree_to_paths(tree: SelectionTree, prefix: str = "") -> list[str]:
    """Inverse of `parse_paths`."""

    out: list[str] = []
    for key, value in tree.items():
        path = f"{prefix}.{key}" if prefix else key
        if value is True:
            out.append(path)
        elif isinstance(value, dict):
            out.extend(tree_to_paths(value, path))
    return out


def subselect(paths: Iterable[str], prefix: str) -> list[str]:
    """Return all paths under `prefix`, stripped of the prefix.

    Examples:
        subselect(["id", "author.id", "author.name"], "author") -> ["id", "name"]
    """

    head = f"{prefix}."
    out: list[str] = []
    for raw in paths:
        if raw == prefix:
            continue
        if raw.startswith(head):
            out.append(raw[len(head) :])
    return out


def has_path(paths: Iterable[str], target: str) -> bool:
    """Return True if `target` (or any descendant of `target`) is selected."""

    head = f"{target}."
    return any(p == target or p.startswith(head) for p in paths)


def paths_intersect(left: str, right: str) -> bool:
    """Return True if one path is a prefix of (or equal to) the other.

    Mirrors the TS helper used by live filtering.
    """

    return left == right or left.startswith(f"{right}.") or right.startswith(f"{left}.")


def filter_by_paths(value: object, paths: Iterable[str]) -> object:
    """Return a deep copy of `value` containing only the dotted paths in `paths`.

    - Dicts: only requested keys are kept.
    - Lists: each item is filtered by the same subselection.
    - For list-shaped relations matching the connection contract
      ({"items": [...], "pagination": {...}}), nested paths under "items.node"
      or "items" still work because we recurse.
    """

    tree = parse_paths(paths)
    return _filter(value, tree)


def _filter(value: object, tree: SelectionTree | bool) -> object:
    if tree is True:
        return value
    if not isinstance(tree, dict):
        return value
    if isinstance(value, dict):
        source = cast(dict[str, object], value)
        out: dict[str, object] = {}
        for key, subtree in tree.items():
            if key in source:
                out[key] = _filter(source[key], subtree)
        return out
    if isinstance(value, list):
        items = cast(list[object], value)
        return [_filter(item, tree) for item in items]
    return value


__all__ = [
    "SelectionTree",
    "filter_by_paths",
    "has_path",
    "parse_paths",
    "paths_intersect",
    "subselect",
    "tree_to_paths",
]
