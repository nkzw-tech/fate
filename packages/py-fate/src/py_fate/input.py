"""Input validation for mutation operations.

Supports three input declarations:
- `None` — no validation; raw input is passed through.
- A Pydantic model class — `Model.model_validate(input)`.
- A plain callable — sync or async function called with the input. May raise to
  signal validation errors (caught and re-raised as VALIDATION_ERROR).
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, ValidationError

from .protocol import FateRequestError

InputSchema = type[BaseModel] | Callable[[Any], Any] | Callable[[Any], Awaitable[Any]] | None


async def parse_input(schema: InputSchema, value: Any) -> Any:
    if schema is None:
        return value
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        try:
            return schema.model_validate(value)
        except ValidationError as exc:
            raise FateRequestError(
                "VALIDATION_ERROR",
                "Invalid mutation input.",
                issues=exc.errors(include_url=False),
            ) from exc
    if callable(schema):
        try:
            result = schema(value)
            if inspect.isawaitable(result):
                result = await result
            return result
        except FateRequestError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise FateRequestError(
                "VALIDATION_ERROR", "Invalid mutation input.", issues=str(exc)
            ) from exc
    return value


__all__ = ["InputSchema", "parse_input"]
