"""Provider contract tests — every RuntimeProvider must satisfy these.

Subclass ``ProviderContract`` and override ``make_provider()`` and
``make_config()``. Currently exercised by ``InProcessRuntimeProvider``.
``BoxdRuntimeProvider`` has its own deeper tests in test_boxd_provider.py
(those use a mocked SDK; the contract here would require a live provider).
"""
from abc import abstractmethod

import pytest

from bindu.runtime import RuntimeConfig, RuntimeHandle, RuntimeProvider
from bindu.runtime.in_process import InProcessRuntimeProvider


class ProviderContract:
    """Abstract test class. Subclasses override make_provider/make_config."""

    @abstractmethod
    def make_provider(self) -> RuntimeProvider: ...

    @abstractmethod
    def make_config(self) -> RuntimeConfig: ...

    @pytest.mark.asyncio
    async def test_deploy_returns_handle(self):
        p = self.make_provider()
        h = await p.deploy("contract-test", None, self.make_config())
        assert isinstance(h, RuntimeHandle)
        assert h.name == "contract-test"
        assert h.url
        assert h.provider

    @pytest.mark.asyncio
    async def test_health_returns_bool(self):
        p = self.make_provider()
        h = await p.deploy("contract-test", None, self.make_config())
        result = await p.health(h)
        assert isinstance(result, bool)

    @pytest.mark.asyncio
    async def test_on_exit_detach(self):
        """All providers must support detach (no-op)."""
        p = self.make_provider()
        h = await p.deploy("contract-test", None, self.make_config())
        await p.on_exit(h, "detach")


class TestInProcessProviderContract(ProviderContract):
    def make_provider(self):
        return InProcessRuntimeProvider()

    def make_config(self):
        return RuntimeConfig.from_dict(None)
