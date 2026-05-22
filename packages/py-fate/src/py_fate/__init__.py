"""py-fate — Python server for the fate wire protocol."""

from .connection import resolve_connection
from .data_view import (
    ComputedField,
    DataView,
    EntityT,
    ListField,
    ResolverField,
    Scalar,
    as_view,
    computed,
    list_field,
    resolver,
)
from .executor import (
    ListDefinition,
    MutationDefinition,
    QueryDefinition,
    ServerRegistry,
)
from .http import (
    FateHTTPRequest,
    FateHTTPResponse,
    FateSSEResponse,
    json_response,
)
from .live import (
    InMemoryLiveEventBus,
    LiveConnectionSourceEvent,
    LiveEventBus,
    LiveSourceEvent,
    create_live_event_bus,
)
from .protocol import (
    PROTOCOL_VERSION,
    FateOperation,
    FateOperationErr,
    FateOperationOk,
    FateOperationResult,
    FateProtocolError,
    FateProtocolErrorCode,
    FateProtocolRequest,
    FateProtocolResponse,
    FateRequestError,
    Pagination,
    status_from_error_code,
)
from .server import FateServer, create_fate_server, new_connection_id
from .source import (
    ByIdRequest,
    ConnectionRequest,
    DictSourceAdapter,
    SourceAdapter,
)

__version__ = "0.1.0"

__all__ = [
    "ByIdRequest",
    "ComputedField",
    "ConnectionRequest",
    "DataView",
    "DictSourceAdapter",
    "EntityT",
    "FateHTTPRequest",
    "FateHTTPResponse",
    "FateOperation",
    "FateOperationErr",
    "FateOperationOk",
    "FateOperationResult",
    "FateProtocolError",
    "FateProtocolErrorCode",
    "FateProtocolRequest",
    "FateProtocolResponse",
    "FateRequestError",
    "FateSSEResponse",
    "FateServer",
    "InMemoryLiveEventBus",
    "ListDefinition",
    "ListField",
    "LiveConnectionSourceEvent",
    "LiveEventBus",
    "LiveSourceEvent",
    "MutationDefinition",
    "PROTOCOL_VERSION",
    "Pagination",
    "QueryDefinition",
    "ResolverField",
    "Scalar",
    "ServerRegistry",
    "SourceAdapter",
    "__version__",
    "as_view",
    "computed",
    "create_fate_server",
    "create_live_event_bus",
    "json_response",
    "list_field",
    "new_connection_id",
    "resolve_connection",
    "resolver",
    "status_from_error_code",
]
