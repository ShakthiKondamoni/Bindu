# Bindu RuntimeProvider — design

**Date:** 2026-04-29
**Status:** Approved (sections 1–3 walkthrough w/ user); 4–8 written here for the record.
**Scope:** introduce a `RuntimeProvider` abstraction in bindu and a `BoxdRuntimeProvider` that runs a bindu agent inside a boxd microVM.

---

## 0. One-paragraph summary

A bindu agent today is a Python function that runs in the user's process. This change lets the user declare `runtime={"provider": "boxd", ...}` in `bindufy()`, and the agent then runs as a real microservice inside a boxd VM — its own machine, IP, HTTPS domain, DID keys, x402 wallet, OAuth tokens. The host bindu becomes a deploy tool: it packages source, ships it to the VM, starts the agent, prints the public URL, and supervises until the user exits. After that the agent serves traffic directly from the VM. No router. No state reconciliation. No special in-VM code path — the agent inside the VM is a vanilla bindu instance.

## 1. Architecture

```
USER MACHINE (the dev box)              BOXD VM ("my-agent.boxd.sh")
┌──────────────────────────────┐        ┌─────────────────────────────────┐
│ python my_agent.py           │        │ /app/                           │
│   bindufy(config, handler,   │ ──ship│   my_agent.py                   │
│           runtime=...)       │  code  │   pyproject.toml                │
│                              │ ─────▶│                                 │
│  ┌────────────────────────┐  │        │ bindu serve --script my_agent.py│
│  │ BoxdRuntimeProvider    │  │        │   ↓                             │
│  │  - resolve VM          │  │        │   bindufy(config, handler)      │
│  │  - ship source         │  │        │   HTTP/A2A on :3773             │
│  │  - install deps        │  │        │   .well-known/agent.json        │
│  │  - exec bindu serve    │  │        │   .well-known/did.json          │
│  │  - health check        │  │        │                                 │
│  │  - stream logs         │  │        │ DID keys, x402 wallet, OAuth    │
│  │  - on Ctrl-C: detach   │  │        │ all live HERE, in the VM        │
│  └────────────────────────┘  │        │                                 │
└──────────────────────────────┘        └─────────────────────────────────┘
                                                      ▲
                                                      │ A2A clients
                                                      │ talk directly
                                                      │ to the VM
```

## 2. Module layout (bindu side)

```
bindu/runtime/
  __init__.py          # public API: RuntimeProvider, RuntimeHandle, register/get_provider
  base.py              # ABC + dataclasses + provider registry
  in_process.py        # InProcessRuntimeProvider (default; no-op deploy)
  boxd_provider.py     # BoxdRuntimeProvider
  source_packager.py   # tar+gzip working dir, ignore handling
  config.py            # RuntimeConfig dataclass + validation

bindu/cli/__init__.py  # extended: `bindu serve --script <path>` subcommand

tests/unit/runtime/
  conftest.py
  test_provider_contract.py    # contract any provider must satisfy
  test_in_process.py
  test_boxd_provider.py        # mocked boxd SDK
  test_source_packager.py
  test_config.py

tests/e2e/runtime/
  test_boxd_e2e.py             # @pytest.mark.boxd_e2e — opt-in, real VM

docs/runtime/
  README.md
  boxd.md
  custom-image.md
```

**Modified:**
- `bindu/penguin/bindufy.py` — detect `runtime=`; dispatch to provider.
- `bindu/common/models.py` — add `RuntimeConfig`.
- `bindu/penguin/config_validator.py` — schema for `runtime` field.
- `bindu/cli/__init__.py` — `bindu serve --script` subcommand.

**Not modified** (the key proof we got this right):
- `bindu/server/workers/manifest_worker.py`
- `bindu/server/task_manager.py`
- `bindu/server/applications.py`
- `bindu/extensions/*`

The host doesn't run the manifest in runtime mode — the VM does. Worker/task/extensions stay untouched.

## 3. Lifecycle

```
1. bindufy() called with runtime config
2. Validate handler + config (existing path)
3. Build RuntimeConfig from user config
4. provider = get_provider(runtime.provider)
5. handle = await provider.deploy(manifest, source_dir, runtime_config)
   ├─ resolve VM (idempotent by config["name"])
   ├─ ship source (A2) or skip (A1, image-based)
   ├─ install deps in VM (A2 only)
   ├─ exec `bindu serve --script ...` inside VM
   └─ poll /health until ready or timeout
6. Print public URL
7. provider.stream_logs(handle) → host stdout
8. Block until SIGINT
9. provider.on_exit(handle, mode=runtime.on_exit)
   ├─ "suspend" (default): detach; boxd auto-suspends
   ├─ "destroy": destroy VM
   └─ "detach": exit immediately, leave VM running
```

### Idempotency

VM name = `config["name"]`. Re-running bindufy with the same agent name updates the existing VM. Different name = different VM.

### Source change detection

v1: ship every time. `pip install -e .` is a no-op on already-installed packages. A v2 optimization can hash the working dir to skip ship.

### What lives where

| Concern | Location | Why |
|---|---|---|
| DID keys | VM (`/var/lib/bindu/did/`) | Identity bound to runtime |
| x402 wallet | VM | Agent owns its wallet |
| OAuth tokens | VM | Issued to the agent's URL |
| `BOXD_API_KEY` | Host (env) | Used to manage the VM. Never shipped. |
| `OPENAI_API_KEY` etc. | VM (via `.env` shipped) | Agent needs them at runtime |

## 4. Code shipping

### A2 — live source mount (default)

**Source root discovery:** walk up from the user's script looking for `pyproject.toml`, `setup.py`, `requirements.txt`, or `.git`. If none, use the script's parent dir.

**Includes:** `*.py`, `*.toml`, `*.txt`, `*.md`, `*.json`, `*.yaml`, `*.yml`, `.env`, sub-packages.
**Excludes (default):** `__pycache__/`, `*.pyc`, `.git/`, `.venv/`, `venv/`, `node_modules/`, `*.log`, `*.sqlite`, `*.db`, plus everything in `.gitignore` and `.binduignore`.
**Hard cap:** 50 MB compressed. Bigger → error pointing to `.binduignore`.

**Mechanism:** tar+gzip → `box.write_file(bytes, "/tmp/source.tar.gz")` → `box.exec("tar", "xzf", "/tmp/source.tar.gz", "-C", "/app")`.

**Dependency install (in this order, whichever exists):**
1. `pip install bindu` (always; latest stable from PyPI — eventually pinned to the bindu version that produced the PR)
2. `pip install -r requirements.txt`
3. `pip install -e .` (if `pyproject.toml` or `setup.py`)

**Note:** until the boxd Python SDK is on PyPI, agents that *use* the boxd SDK from inside the VM (rare — it's the host that talks to boxd) would have to install it from a wheel. This isn't part of v1's path; the agent inside the VM doesn't need the boxd SDK.

### A1 — user-built image

```python
runtime={"provider": "boxd", "image": "ghcr.io/me/my-agent:v1"}
```

Presence of `image` switches the provider to A1: `box.create(name, config=BoxConfig(image=...))`, no source ship, no `pip install`. The image's CMD is the entrypoint; we just verify the agent boots and serves.

### A1 vs A2 selector

```python
if runtime_config.image:
    handle = await self._deploy_a1(manifest, runtime_config)
else:
    handle = await self._deploy_a2(manifest, source_dir, runtime_config)
```

Health check, log streaming, lifecycle, on_exit handling — all shared between modes.

## 5. RuntimeProvider abstraction

```python
# bindu/runtime/base.py

@dataclass
class RuntimeHandle:
    name: str
    url: str            # public URL the agent serves on
    provider: str       # "boxd", "in-process", etc.
    metadata: dict      # provider-specific (vm_id, public_ip, ...)

class RuntimeProvider(ABC):
    @abstractmethod
    async def deploy(
        self,
        manifest: AgentManifest,
        source_dir: Path | None,
        config: RuntimeConfig,
    ) -> RuntimeHandle: ...

    @abstractmethod
    async def health(self, handle: RuntimeHandle) -> bool: ...

    @abstractmethod
    async def stream_logs(
        self, handle: RuntimeHandle, follow: bool = True
    ) -> AsyncIterator[bytes]: ...

    @abstractmethod
    async def on_exit(
        self, handle: RuntimeHandle, mode: Literal["suspend", "destroy", "detach"]
    ) -> None: ...

# Provider registry
_providers: dict[str, type[RuntimeProvider]] = {}

def register_provider(name: str, cls: type[RuntimeProvider]) -> None: ...
def get_provider(name: str) -> RuntimeProvider: ...
```

### InProcessRuntimeProvider (the default)

Today's behavior, framed as a runtime provider. `deploy()` returns a handle pointing at the local server, `on_exit("destroy")` does the in-process shutdown. This isn't strictly necessary for shipping A, but it makes the abstraction symmetric and makes "default behavior" inspectable.

If implementing it slows the PR down, ship just `BoxdRuntimeProvider` and let `bindufy()` do the in-process path inline (status quo). We'll decide during execution.

## 6. Configuration shape

```python
bindufy(config, handler, runtime={
    "provider": "boxd",
    # A1 mode (optional):
    "image": "ghcr.io/me/my-agent:v1",
    # VM resources (optional, passed to BoxConfig):
    "vcpu": 2,                     # default 2
    "memory": "4G",                # default "4G"
    "disk": "20G",                 # default "20G"
    # Lifecycle:
    "auto_suspend": 60,            # seconds idle → suspend; default 60
    "on_exit": "suspend",          # suspend | destroy | detach; default "suspend"
    # Bindu version pin (A2 only):
    "bindu_version": "0.1.0",      # default: same version as host
    # Extra env (in addition to .env in source):
    "env": {"OPENAI_MODEL": "gpt-4o"},
})
```

Validated in `bindu/penguin/config_validator.py` at `bindufy()` time. Missing `BOXD_API_KEY` env → fail fast with actionable error.

## 7. Routing & identity

**Once the VM is up, the host is out of the loop.**

A2A clients hit `https://{config["name"]}.boxd.sh` directly. The agent inside the VM publishes:
- `/.well-known/agent.json` — agent card with the public URL
- `/.well-known/did.json` — DID document for agent identity
- `/health` — used by host's health check, also by external monitoring
- `POST /` — A2A JSON-RPC endpoint

**URL injection.** The host sets `BINDU_PUBLIC_URL` env var when starting the agent in the VM. The bindu agent reads it and overrides `config["deployment"]["url"]` before publishing the agent card. This way the user's script can keep `url: "http://localhost:3773"` for local dev and the framework substitutes the public URL transparently in runtime mode.

**DID generation.** The agent in the VM generates its DID on first boot (existing behavior in `bindu/extensions/did/`). The boxd persistent disk preserves the keys across suspend/resume. A destroyed VM = a new DID on next deploy. That's a feature, not a bug — destroying a VM is "throwing away the agent."

**Auth keys.** Same: the agent in the VM owns its OAuth client credentials, x402 wallet. The host never sees them.

## 8. Error handling & failure modes

| Failure | Detection | User feedback | VM state after |
|---|---|---|---|
| `BOXD_API_KEY` missing | `bindufy()` validation | Fail fast: "set BOXD_API_KEY" | n/a |
| Boxd auth invalid | First SDK call (401) | "boxd authentication failed: <message>" | n/a |
| VM quota exceeded | `box.create()` raises `QuotaExceededError` | "boxd VM cap reached; destroy unused agents" | n/a |
| Source >50 MB | `source_packager` pre-flight | "source too large; add to .binduignore" | n/a |
| Source ship fails (network) | `box.write_file` raises | "failed to ship source: <error>" | VM left in current state |
| `pip install` fails | exit code from `box.exec` | Stream pip output; exit non-zero | VM up, debuggable via shell |
| Agent fails to start | health check timeout (60s cold / 10s warm) | Dump last 50 log lines | VM up, debuggable |
| VM crashes mid-supervise | gRPC stream error | "VM lost: <reason>; check `bindu logs <name>`" | varies |
| User Ctrl-C | SIGINT handler | Apply `on_exit` policy | per `on_exit` |

**`bindu shell <agent-name>`** opens an interactive shell on the agent's VM. Trivial via `box.exec("bash", interactive=True)`. Drops the user into `/app` with the agent's environment.

**`bindu logs <agent-name>`** streams logs from the VM. `--since`, `--tail` flags optional in v1.

## 9. Testing strategy

### Unit tests (`tests/unit/runtime/`, mocked SDK)

- `test_provider_contract.py` — abstract test class any provider must satisfy. Subclassed by each provider's tests. Validates: `deploy` returns a RuntimeHandle with all fields set; `health` returns bool; `stream_logs` yields bytes; `on_exit` accepts all three modes.
- `test_in_process.py` — sanity for the default path.
- `test_boxd_provider.py` — every method tested with the boxd SDK fully mocked. Verifies the right SDK calls happen in the right order. ~15–20 tests.
- `test_source_packager.py` — ignore patterns, size cap, tarball contents, project root discovery. ~10 tests.
- `test_config.py` — RuntimeConfig validation, defaults, env-var resolution. ~8 tests.

### E2E test (`tests/e2e/runtime/test_boxd_e2e.py`, opt-in)

Single test, marked `@pytest.mark.boxd_e2e`, skipped unless `BOXD_E2E=1`. Steps:
1. Create a real VM (calls `boxd.Compute(api_key=...)` from the test).
2. Ship a tiny echo agent.
3. Wait for health.
4. Make an A2A request via HTTP.
5. Assert response.
6. Destroy VM.

This is the test that proves the integration actually works. Run once before declaring the PR done. **Will not run** until the user explicitly approves.

### Existing bindu test suite

Must keep passing unmodified — runtime mode is opt-in, default is in-process.

## 10. Out of scope (v1)

- Base image at `ghcr.io/azin-tech/bindu-runtime` — described in design, not built or published in this PR. v1 uses the default boxd image + `pip install` at deploy.
- Source-hash-based ship skip (v2 perf optimization).
- Multi-region / multi-zone deployment.
- Auto-scaling / multi-replica per agent (one VM per agent).
- Non-boxd providers (e2b, modal, fly.io). The abstraction is designed for them, but only `boxd_provider.py` ships.
- Bidirectional code reload during dev (i.e., live source-watch + redeploy on file change). Punted to v2.
- API-key delegation from host to VM (v1: user puts secrets in `.env`).

## 11. Naming

- Bindu config key: `runtime` (not `sandbox`).
- Bindu module: `bindu.runtime`.
- Provider class: `RuntimeProvider`.
- Default provider: `"in-process"` (literal string).
- Boxd provider: `"boxd"`.

We push back on the "sandbox" wording with the Bindu founder if needed — `runtime` is more accurate (a sandbox is a constrained tool environment; this is a full execution runtime).

---

## Open questions for the user (to revisit during execution)

1. **In-process provider:** ship it (clean abstraction) or skip (smaller PR)? Default plan: skip if it adds >100 LOC; ship if cheap.
2. **`bindu shell <name>` and `bindu logs <name>`:** are these in this PR, or follow-up? Default plan: include — they're tiny and big DX wins.
3. **`bindu serve --script <path>` CLI:** lives in `bindu/cli/__init__.py`. Trivial extension.
