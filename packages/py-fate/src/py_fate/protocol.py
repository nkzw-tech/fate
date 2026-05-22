"""Wire-protocol types and helpers for the fate protocol (version 1).

Mirrors `packages/fate/src/protocol.ts`.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

FateProtocolVersion = Literal[1]
PROTOCOL_VERSION: FateProtocolVersion = 1

FateOperationKind = Literal["byId", "list", "mutation", "query"]

FateProtocolErrorCode = Literal[
    "BAD_REQUEST",
    "FORBIDDEN",
    "INTERNAL_ERROR",
    "NOT_FOUND",
    "UNAUTHORIZED",
    "VALIDATION_ERROR",
]


_STATUS_BY_CODE: dict[FateProtocolErrorCode, int] = {
    "BAD_REQUEST": 400,
    "VALIDATION_ERROR": 400,
    "UNAUTHORIZED": 401,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "INTERNAL_ERROR": 500,
}


def status_from_error_code(code: FateProtocolErrorCode) -> int:
    return _STATUS_BY_CODE[code]


def error_code_from_status(status: int) -> FateProtocolErrorCode:
    if status == 400:
        return "BAD_REQUEST"
    if status == 401:
        return "UNAUTHORIZED"
    if status == 403:
        return "FORBIDDEN"
    if status == 404:
        return "NOT_FOUND"
    return "INTERNAL_ERROR"


class FateProtocolError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: FateProtocolErrorCode
    message: str
    issues: Any | None = None
    path: str | None = None


class FateRequestError(Exception):
    """Exception thrown by handlers to map to a protocol error."""

    code: FateProtocolErrorCode
    message: str
    issues: Any | None
    path: str | None
    status: int

    def __init__(
        self,
        code: FateProtocolErrorCode,
        message: str,
        *,
        issues: Any | None = None,
        status: int | None = None,
        path: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.issues = issues
        self.path = path
        self.status = status if status is not None else status_from_error_code(code)


def to_protocol_error(error: BaseException) -> FateProtocolError:
    if isinstance(error, FateRequestError):
        return FateProtocolError(
            code=error.code,
            message=error.message,
            issues=error.issues,
            path=error.path,
        )
    return FateProtocolError(code="INTERNAL_ERROR", message="Internal server error.")


class FateOperation(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    kind: FateOperationKind
    select: list[str]
    args: dict[str, Any] | None = None
    ids: list[str | int] | None = None
    input: Any | None = None
    name: str | None = None
    type: str | None = None


class FateProtocolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: FateProtocolVersion
    operations: list[FateOperation]


class FateOperationOk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    ok: Literal[True] = True
    data: Any = None


class FateOperationErr(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    ok: Literal[False] = False
    error: FateProtocolError


FateOperationResult = FateOperationOk | FateOperationErr


class FateProtocolResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: FateProtocolVersion = PROTOCOL_VERSION
    results: list[FateOperationResult]


class Pagination(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hasNext: bool
    hasPrevious: bool
    nextCursor: str | None = None
    previousCursor: str | None = None


class ConnectionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cursor: str | None = None
    node: Any


class FateConnectionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ConnectionItem]
    pagination: Pagination


# ---------- Live (SSE) ----------


class FateLiveDataEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    data: Any
    delete: Literal[False] | None = None
    select: list[str] | None = None
    type: Literal["data", "update"] | None = None


class FateLiveDeleteEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    delete: Literal[True] = True
    id: str | int | None = None
    type: Literal["delete"] | None = None


FateLiveEvent = FateLiveDataEvent | FateLiveDeleteEvent


class FateLiveConnectionEdgeEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal[
        "appendEdge",
        "appendNode",
        "insertEdgeAfter",
        "insertEdgeBefore",
        "prependEdge",
        "prependNode",
    ]
    edge: dict[str, Any]
    nodeType: str
    targetCursor: str | None = None


class FateLiveConnectionDeleteEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["deleteEdge"] = "deleteEdge"
    id: str | int
    nodeType: str


class FateLiveConnectionInvalidateEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["invalidate"] = "invalidate"


FateLiveConnectionEvent = (
    FateLiveConnectionEdgeEvent
    | FateLiveConnectionDeleteEvent
    | FateLiveConnectionInvalidateEvent
)


class FateLiveSubscribeOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["subscribe"]
    type: str
    entityId: str | int
    select: list[str]
    args: dict[str, Any] | None = None
    lastEventId: str | None = None


class FateLiveConnectionSubscribeOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["subscribeConnection"]
    type: str
    procedure: str
    select: list[str]
    args: dict[str, Any] | None = None
    selectionArgs: dict[str, Any] | None = None
    lastEventId: str | None = None


class FateLiveUnsubscribeOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["unsubscribe"]


FateLiveControlOperation = (
    FateLiveSubscribeOperation
    | FateLiveConnectionSubscribeOperation
    | FateLiveUnsubscribeOperation
)


class FateLiveControlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: FateProtocolVersion
    connectionId: str
    operations: list[FateLiveControlOperation] = Field(default_factory=list)


class FateLiveMessageNext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["next"] = "next"
    event: FateLiveEvent


class FateLiveMessageConnection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["connection"] = "connection"
    event: FateLiveConnectionEvent


class FateLiveMessageError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["error"] = "error"
    error: FateProtocolError


FateLiveMessage = FateLiveMessageNext | FateLiveMessageConnection | FateLiveMessageError


__all__ = [
    "PROTOCOL_VERSION",
    "ConnectionItem",
    "FateConnectionResult",
    "FateLiveConnectionDeleteEvent",
    "FateLiveConnectionEdgeEvent",
    "FateLiveConnectionEvent",
    "FateLiveConnectionInvalidateEvent",
    "FateLiveConnectionSubscribeOperation",
    "FateLiveControlOperation",
    "FateLiveControlRequest",
    "FateLiveDataEvent",
    "FateLiveDeleteEvent",
    "FateLiveEvent",
    "FateLiveMessage",
    "FateLiveMessageConnection",
    "FateLiveMessageError",
    "FateLiveMessageNext",
    "FateLiveSubscribeOperation",
    "FateLiveUnsubscribeOperation",
    "FateOperation",
    "FateOperationErr",
    "FateOperationKind",
    "FateOperationOk",
    "FateOperationResult",
    "FateProtocolError",
    "FateProtocolErrorCode",
    "FateProtocolRequest",
    "FateProtocolResponse",
    "FateProtocolVersion",
    "FateRequestError",
    "Pagination",
    "error_code_from_status",
    "status_from_error_code",
    "to_protocol_error",
]
