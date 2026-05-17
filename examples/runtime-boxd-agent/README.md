# Runtime-boxd Agent

The same `bindufy(config, handler)` shape as every other example, but designed to be deployed to a [boxd](https://boxd.sh) microVM. Locally it's a plain echo agent. On `bindu deploy --runtime=boxd`, the CLI ships this directory to a VM and starts the agent there — own public URL, own DID, persistent disk across suspend/resume.

The agent code is the same in both places. Only the deploy command changes.

## Setup

This folder has its own `pyproject.toml` (so the example is portable to a VM), so `--extra agents` from the parent project doesn't apply. Pass bindu explicitly:

```bash
uv run --with /path/to/Bindu agent.py
# or, when installed from PyPI:
uv run --with bindu agent.py
```

## Run locally

```bash
uv run --with /Users/raahuldutta/Documents/GetBindu/Bindu agent.py
# http://localhost:3773
```

## Deploy to a boxd VM

```bash
pip install 'bindu[runtime-boxd]'
export BOXD_TOKEN=$(boxd login --json | jq -r .token)
bindu deploy agent.py --runtime=boxd --on-exit=suspend
```

When you see `✓ runtime-boxd-example serving at https://...`, the VM is live. Hit it the same way you'd hit any other bindu agent:

```bash
curl https://runtime-boxd-example.boxd.sh/.well-known/agent.json
curl https://runtime-boxd-example.boxd.sh/health
```

Ctrl-C on the local terminal suspends the VM (preserves memory + disk + DID keys). Re-running `bindu deploy` resumes in ~1s.

## Talk to it (local)

With `AUTH__ENABLED=false`:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"echo me"}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

See [`docs/runtime/`](../../docs/runtime/) for the runtime-provider abstraction and [`docs/AUTH.md`](../../docs/AUTH.md) for the auth-on flow.
