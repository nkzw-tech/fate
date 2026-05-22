import pytest
from pydantic import ValidationError

from py_fate.protocol import (
    FateLiveControlRequest,
    FateOperation,
    FateProtocolRequest,
    FateRequestError,
    error_code_from_status,
    status_from_error_code,
    to_protocol_error,
)


def test_status_round_trip() -> None:
    for code in (
        "BAD_REQUEST",
        "VALIDATION_ERROR",
        "UNAUTHORIZED",
        "FORBIDDEN",
        "NOT_FOUND",
        "INTERNAL_ERROR",
    ):
        status = status_from_error_code(code)  # type: ignore[arg-type]
        # VALIDATION_ERROR is also 400 — error_code_from_status returns BAD_REQUEST for 400.
        round_tripped = error_code_from_status(status)
        if code == "VALIDATION_ERROR":
            assert round_tripped == "BAD_REQUEST"
        else:
            assert round_tripped == code


def test_status_mapping() -> None:
    assert status_from_error_code("BAD_REQUEST") == 400
    assert status_from_error_code("VALIDATION_ERROR") == 400
    assert status_from_error_code("UNAUTHORIZED") == 401
    assert status_from_error_code("FORBIDDEN") == 403
    assert status_from_error_code("NOT_FOUND") == 404
    assert status_from_error_code("INTERNAL_ERROR") == 500


def test_to_protocol_error_preserves_fate_request_error() -> None:
    err = FateRequestError("FORBIDDEN", "nope", issues=["one"], path="x")
    p = to_protocol_error(err)
    assert p.code == "FORBIDDEN"
    assert p.message == "nope"
    assert p.issues == ["one"]
    assert p.path == "x"


def test_to_protocol_error_sanitizes_unknown_exception() -> None:
    p = to_protocol_error(RuntimeError("secret token leaked"))
    assert p.code == "INTERNAL_ERROR"
    assert p.message == "Internal server error."


def test_protocol_request_parses_byid() -> None:
    payload = {
        "version": 1,
        "operations": [
            {
                "id": "1",
                "kind": "byId",
                "type": "Post",
                "ids": ["a", 2],
                "select": ["id", "title"],
            }
        ],
    }
    req = FateProtocolRequest.model_validate(payload)
    op = req.operations[0]
    assert op.kind == "byId"
    assert op.ids == ["a", 2]


def test_protocol_request_rejects_invalid_version() -> None:
    with pytest.raises(ValidationError):
        FateProtocolRequest.model_validate({"version": 2, "operations": []})


def test_live_control_subscribe_parses() -> None:
    payload = {
        "version": 1,
        "connectionId": "abc",
        "operations": [
            {
                "id": "s1",
                "kind": "subscribe",
                "type": "Post",
                "entityId": "p-1",
                "select": ["id", "title"],
            }
        ],
    }
    req = FateLiveControlRequest.model_validate(payload)
    assert req.connectionId == "abc"
    assert req.operations[0].kind == "subscribe"


def test_operation_kind_invalid_rejected() -> None:
    with pytest.raises(ValidationError):
        FateOperation.model_validate({"id": "1", "kind": "bogus", "select": []})
