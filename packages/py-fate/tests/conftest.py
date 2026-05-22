import pytest

pytest_plugins = ["pytest_asyncio"]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
