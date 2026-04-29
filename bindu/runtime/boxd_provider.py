"""BoxdRuntimeProvider — runs a bindu agent inside a boxd microVM.

Two modes:

- **A2** (default): ship local source via tar+gzip, install deps in the VM,
  exec ``bindu serve --script <agent>``.
- **A1**: provide an ``image`` field; boxd creates the VM from that image
  and the image's CMD is the entry point. No source ship.

The host's role ends after the agent is healthy. A2A clients then talk
directly to the VM's public URL.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, AsyncIterator, Literal

from bindu.runtime.base import RuntimeHandle, RuntimeProvider, register_provider
from bindu.runtime.config import RuntimeConfig
from bindu.runtime.source_packager import build_tarball


def _make_compute(**kwargs: Any):
    """Indirection so tests can monkey-patch in a fake Compute."""
    from boxd.aio import Compute

    return Compute(**kwargs)


class BoxdRuntimeProvider(RuntimeProvider):
    async def _resolve_vm(
        self, compute: Any, name: str, config: RuntimeConfig
    ) -> Any:
        """Get or create the VM for this agent (idempotent by name)."""
        from boxd import BoxConfig, LifecycleConfig
        from boxd.errors import NotFoundError

        try:
            return await compute.box.get(name)
        except NotFoundError:
            pass

        box_config = BoxConfig(
            vcpu=config.vcpu,
            memory=config.memory,
            disk=config.disk,
            lifecycle=LifecycleConfig(
                auto_suspend_timeout=config.auto_suspend,
            ),
        )
        create_kwargs: dict[str, Any] = {
            "name": name,
            "config": box_config,
        }
        if config.image:
            create_kwargs["image"] = config.image
        return await compute.box.create(**create_kwargs)

    async def _ship_source(self, box: Any, source_dir: Path) -> None:
        """Tar+gzip ``source_dir``, upload, extract to ``/app`` in the VM."""
        blob = build_tarball(source_dir)
        await box.write_file(blob, "/tmp/source.tar.gz")
        await box.exec("mkdir", "-p", "/app")
        result = await box.exec(
            "tar", "xzf", "/tmp/source.tar.gz", "-C", "/app"
        )
        if getattr(result, "exit_code", 0) != 0:
            stderr = getattr(result, "stderr", "")
            raise RuntimeError(f"failed to extract source in VM: {stderr}")

    async def _install_deps(
        self,
        box: Any,
        has_pyproject: bool,
        has_requirements: bool,
        bindu_version: str | None = None,
    ) -> None:
        """Install bindu + the user's deps inside the VM (in /app)."""
        bindu_pkg = f"bindu=={bindu_version}" if bindu_version else "bindu"
        commands: list[tuple[str, ...]] = [("pip", "install", bindu_pkg)]
        if has_requirements:
            commands.append(("pip", "install", "-r", "/app/requirements.txt"))
        if has_pyproject:
            commands.append(("pip", "install", "-e", "."))
        for cmd in commands:
            result = await box.exec(*cmd)
            if getattr(result, "exit_code", 0) != 0:
                stderr = getattr(result, "stderr", "")
                raise RuntimeError(
                    f"command {cmd} failed in VM: {stderr}"
                )

    async def deploy(
        self,
        agent_name: str,
        source_dir: Path | None,
        config: RuntimeConfig,
        env: dict[str, str] | None = None,
    ) -> RuntimeHandle:
        raise NotImplementedError("Task 11: full deploy")

    async def health(self, handle: RuntimeHandle) -> bool:
        raise NotImplementedError("Task 12")

    async def stream_logs(
        self, handle: RuntimeHandle, follow: bool = True
    ) -> AsyncIterator[bytes]:
        raise NotImplementedError("Task 12")
        if False:  # pragma: no cover
            yield b""

    async def on_exit(
        self,
        handle: RuntimeHandle,
        mode: Literal["suspend", "destroy", "detach"],
    ) -> None:
        raise NotImplementedError("Task 12")


register_provider("boxd", BoxdRuntimeProvider)
