"""Topic naming — mirrors `packages/fate/src/liveTopics.ts`."""

from __future__ import annotations

import hashlib
import json
from typing import Any
from urllib.parse import quote


def _quote(value: str | int) -> str:
    return quote(str(value), safe="")


PAGINATION_KEYS = frozenset({"after", "before", "first", "last"})


def normalize_connection_args(args: dict[str, Any] | None) -> dict[str, Any]:
    """Drop pagination args; the rest of the args identifies a subscription topic."""

    if not args:
        return {}
    return {k: v for k, v in args.items() if k not in PAGINATION_KEYS}


def _hash_args(args: dict[str, Any]) -> str:
    if not args:
        return "0"
    canonical = json.dumps(args, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha1(canonical.encode("utf-8"), usedforsecurity=False).hexdigest()[:16]


def live_entity_topic(type_name: str, entity_id: str | int) -> str:
    return f"entity:{_quote(type_name)}:{_quote(entity_id)}"


def live_connection_topic(procedure: str, args: dict[str, Any] | None = None) -> str:
    digest = _hash_args(normalize_connection_args(args))
    return f"connection:{_quote(procedure)}:{_quote(digest)}"


def live_global_connection_topic(procedure: str) -> str:
    return f"connection:{_quote(procedure)}:*"


__all__ = [
    "live_connection_topic",
    "live_entity_topic",
    "live_global_connection_topic",
    "normalize_connection_args",
]
