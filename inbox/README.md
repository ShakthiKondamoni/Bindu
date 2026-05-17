# Bindu Inbox

A Gmail-shaped operator console for the A2A network. Every JSON-RPC message between two DIDs lands here as a row, threads group by `context_id`, and signatures are verified inline so you can see whether a peer is actually who it claims to be.

<p align="center">
  <img src="../assets/inbox.png" alt="Bindu inbox — three-pane layout with folders, threads, and a signed message in the right rail" width="900" />
</p>

This README walks you from `git clone` to a signed message landing in the right rail, with auth on the whole way through.

## What ends up running

| Port | Process | What it does |
| --- | --- | --- |
| `3775` | Vite dev server | The React UI you open in your browser |
| `3787` | Hono API (`server/index.ts`) | SQLite event store, webhook intake, outbound A2A composer |
| `<auto>` | Personal agent (Python, spawned on demand) | Your DID + Hydra OAuth client. Listens for inbound A2A and signs everything you send. |
| `3774` | Gateway (optional) | The planner. Only spawns when you message ≥2 agents at once. |
| `3773` | Any bindufy agent you want to talk to | Their A2A endpoint. Not part of the inbox — these are peers. |

`3775` is hard-pinned (Vite refuses to drift) and `3787` is hard-coded; both have to be free before you start.

## Prerequisites

- **Node 20+** and **npm** (the UI and API are both Node).
- **Python 3.12+** and [**uv**](https://github.com/astral-sh/uv). The personal agent is bindufied Python and the inbox spawns it via `uv run`.
- **A bindu checkout with `uv sync` already run.** The inbox locates the repo via `..` from `inbox/`, so cloning Bindu and running the inbox from inside it Just Works. If you moved it, set `BINDU_REPO_DIR`.
- **An OpenRouter API key.** The personal agent uses OpenRouter for its model calls. You can paste it in the Settings tab later, or export `OPENROUTER_API_KEY` before `npm run dev`.

## Start it

```bash
cd inbox
npm install
npm run dev
```

Open <http://127.0.0.1:3775>. You'll see two folders (Inbox, Sent), no contacts yet, and a prompt to set up your operator persona. The bottom-left "personal agent" slot says `down` — that's expected. We turn it on next.

### 1 · Create your persona

Click the gear icon, fill in a name, occupation, and a few personality traits. Save. This writes `~/.bindu/personal/persona.json` and registers you in the inbox DB. Nothing is signed yet — you're still anonymous.

### 2 · Spawn your personal agent (this is what turns auth on)

Click **Start** next to the personal agent slot. The inbox:

1. Picks a free port and writes `~/.bindu/personal/agent.py` from the template in `server/personal-agent.ts`.
2. Writes `~/.bindu/personal/.env` at mode `0600` with `AUTH__ENABLED=true`, `AUTH__PROVIDER=hydra`, your `HYDRA__ADMIN_URL` / `HYDRA__PUBLIC_URL` (default to `getbindu.com`), and your OpenRouter key.
3. Runs `uv run python agent.py` from the bindu repo. Bindufy registers an OAuth client in Hydra (`client_id` = your DID, public key stored in metadata), generates an Ed25519 keypair under `~/.bindu/personal/.bindu/`, and starts serving A2A.

When the spawn returns, the slot flips to **alive** and shows your DID:

```
did:bindu:<author>:<persona-slug>:<uuid>
```

That's your identity from now on. Every outbound message the inbox sends is bearer-token-authed against Hydra **and** Ed25519-signed with this key — same envelope a fully-deployed bindufy agent uses.

### 3 · Add a peer

You need at least one other agent to talk to. If you don't already have one running, the inbox ships a script that spawns two single-purpose demo agents (a joke teller on `5773` and a poet on `5776`) with auth on:

```bash
./scripts/spawn-demo-peers.sh
```

It prints the URLs ready to paste. Then in the UI: sidebar → **Contacts** → **+** → paste `http://127.0.0.1:5773`, then again for `http://127.0.0.1:5776`. The inbox fetches `/.well-known/agent.json`, records each DID, and tags them `protected` because they're running with `AUTH__ENABLED=true`.

Stop them later with `./scripts/stop-demo-peers.sh`.

Bringing your own agent works the same way — any bindufy URL is a valid peer.

### 4 · Send your first message

Click **Compose**, pick the contact, type something. The inbox:

1. Mints (or reuses) a Hydra client-credentials token with `agent:read agent:write`.
2. Builds the JSON-RPC `message/send` envelope.
3. Signs the canonical body with your personal agent's private key, attaches `X-DID`, `X-DID-Signature`, `X-DID-Timestamp`.
4. POSTs to the peer with `Authorization: Bearer <jwt>`.

Two things should happen: a new row in **Sent**, and (once the peer's webhook fires back) a reply in **Inbox**, both threaded under the same `context_id`.

## Verify it's actually using auth

Open a terminal and prove it to yourself:

```bash
# Personal agent rejects anyone who doesn't bring a token:
curl -s -X POST http://127.0.0.1:<personal-agent-port>/ \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"x","params":{"message":{"role":"user","kind":"message","parts":[{"kind":"text","text":"hi"}],"messageId":"m","contextId":"c","taskId":"t"}}}'
# → {"error":{"code":-32009,"message":"Authentication is required ..."}}

# But the inbox can talk to it (it carries the JWT + DID signature):
curl -s -X POST http://127.0.0.1:3787/api/compose \
  -H 'content-type: application/json' \
  -d '{"agentId":"me","text":"hello"}'
# → {"ok":true,"status":200,"contextId":"...","taskId":"...","response":{...}}
```

Find the personal-agent port in the sidebar or via `curl -s http://127.0.0.1:3787/api/me`.

In the UI: open any thread and click **Verify** in the top-right of the right rail. Each row should report `signed / verified` against the peer's published `publicKeyBase58`. The detail rail's **Verify** tab shows the DID match, the signature, and the timestamp nonce.

## What "auth on" means here

There are three independent auth layers in play. The inbox uses all three:

| Layer | Who enforces it | How to turn it on |
| --- | --- | --- |
| **Peer A2A auth** — outbound calls must carry a JWT + DID signature | The peer's bindufy middleware (`-32009` if missing) | Set `AUTH__ENABLED=true` on the peer. Done automatically when the inbox spawns your personal agent. |
| **Operator gate** — `/api/*` on the inbox requires a bearer token | `inbox/server/index.ts` | `export BINDU_COMMS_TOKEN=$(openssl rand -hex 32)` before `npm run dev`. UI then needs `?token=<token>` in the URL (SSE can't send headers). Off by default — single-user dev. |
| **Webhook gate** — agents POSTing to `/webhooks/bindu/:agentId` must carry a bearer token | `inbox/server/index.ts` | `export BINDU_WEBHOOK_TOKEN=<token>` and configure the same value as `global_webhook_token` on the bindufy side. Off by default. |

The first one is non-negotiable once the personal agent is alive. The other two are belt-and-suspenders for multi-user or exposed deployments — leave them off until you actually share the URL.

## Using the inbox

### Layout

| Pane | What it shows |
| --- | --- |
| **Left** | Folders (Inbox / Sent / Drafts / Archive), Contacts grouped into **Gateways** (orchestrators for multi-agent plans) and **Agents** (single-purpose peers). Your operator identity sits at the bottom. |
| **Middle** | Thread list — newest first, one row per `context_id`. The badge is the message count. |
| **Right** | Selected thread, oldest message at top. State pills + DID per row; bodies render inline. Reply composer pinned at the bottom. |

### Sending

- **One agent** → direct A2A `message/send` to that peer.
- **Two or more agents** → comms auto-spawns a gateway (see `gateway-spawned-*` in Contacts), forwards your prompt as a plan, threads the per-agent tool calls under one `context_id`. The gateway's `/plan` is bearer-gated; the inbox auto-loads `GATEWAY_API_KEY` from `gateway/.env.local` if it's there.

### Reading a thread

Each row carries:

- **State pill** — `submitted` · `working` · `input-required` · `payment-required` · `auth-required` · `completed` · `failed`. Multi-agent plans also surface `task-started` / `task-artifact` / `task-finished` / `plan-answer`.
- **Trust pill** — `first-contact` (new peer) · `known` · `self` (your own agents / planner).
- **DID** of the counterparty — click for the full agent card.
- Body text rendered inline; the `<remote_content>` wrapper is stripped for readability.

**Stitched across N lanes** in the header means the thread spans more than one source (e.g. your direct outbox + a gateway-spawned thread sharing the same `context_id`).

### Replying

Type in the box at the bottom of the open thread. `⌘↵` sends. Replies inherit the thread's `context_id` and resume the existing task if it's still open, refine it (with `referenceTaskIds`) if the task ended terminal, or start fresh otherwise.

## Files & directories

| Path | What's there |
| --- | --- |
| `inbox/data/events.db` | SQLite event log. Delete to start fresh; the schema rebuilds on boot. Gitignored. |
| `inbox/.env.local` | Per-developer env. Gitignored. Same shell-env vars below also work. |
| `~/.bindu/personal/persona.json` | Your operator persona. Hand-editable. |
| `~/.bindu/personal/.env` | Mode-`0600` env file: OpenRouter key, Pipedream tokens, Hydra URLs, `AUTH__ENABLED=true`. Regenerated on every spawn. |
| `~/.bindu/personal/agent.py` | Auto-generated bindufy agent. Hand-edits are overwritten — edit `persona.json` or the template in `server/personal-agent.ts`. |
| `~/.bindu/personal/.bindu/oauth_credentials.json` | OAuth client_id + secret from Hydra. Required for outbound token minting. |
| `~/.bindu/personal/.bindu/private.pem` | Ed25519 private key. Required for DID signatures. |
| `~/.bindu/personal/logs/agent.log` | Personal agent stdout/stderr. Tail this when spawn fails. |

## Environment knobs

All optional unless noted:

| Var | Default | Why |
| --- | --- | --- |
| `BINDU_COMMS_TOKEN` | unset | Bearer token gate on `/api/*`. See "auth on" above. |
| `BINDU_WEBHOOK_TOKEN` | unset | Bearer token gate on `/webhooks/bindu/*`. Must match agent-side `global_webhook_token`. |
| `BINDU_AGENT_URLS` | unset | `id=url,id=url` pairs that override the agents table. Ops escape hatch. |
| `BINDU_REPO_DIR` | `..` | Where bindu lives. Needed if you moved the inbox out of the repo. |
| `BINDU_PERSONAL_DIR` | `~/.bindu/personal` | Personal agent files. Useful for sandboxing tests. |
| `BINDU_GATEWAY_DIR` | `../gateway` | Where the gateway lives. Needed if you split repos. |
| `GATEWAY_API_KEY` | read from `gateway/.env.local` | Bearer the inbox sends to the gateway's `/plan`. Without it multi-agent compose 401s. |
| `HYDRA__PUBLIC_URL` | `https://hydra.getbindu.com` | Token endpoint for outbound Hydra minting. |
| `OPENROUTER_API_KEY` | unset | Required for the personal agent. UI Settings tab is the recommended path. |
| `BINDU_COMMS_MAX_HISTORY` | `30` | Max user/assistant turns the inbox forwards to the gateway on `/plan`. |

## Troubleshooting

**`-32009` on every send.** Personal agent isn't running, or its Hydra OAuth client isn't registered. Check `~/.bindu/personal/.bindu/oauth_credentials.json` exists. Stop and re-spawn from the UI; watch `~/.bindu/personal/logs/agent.log`.

**`pipedream-not-configured` on tool connect.** Personal agent works fine without Pipedream — only Gmail/Notion MCP tools need it. Either ignore or set `PIPEDREAM_PROJECT_ID` + `PIPEDREAM_CLIENT_ID` + `PIPEDREAM_CLIENT_SECRET` in the Settings tab.

**`unauthorized` on `/api/plan`.** Either `GATEWAY_API_KEY` isn't loaded (inbox prints a warning at boot) or it doesn't match the gateway's own value. The inbox auto-reads `gateway/.env.local` — make sure it's not stale.

**Port 3775 or 3787 already in use.** `lsof -ti:3775 -ti:3787` and kill, or accept that another inbox is running.

**Spawn says `no-openrouter-key`.** Add the key in the Settings tab, or `export OPENROUTER_API_KEY=...` before `npm run dev`.

**`SyntaxError` on Python startup.** You're on a Python below 3.12 — `uv sync` against the right interpreter, or set `BINDU_PERSONAL_USE_VENV=1` and point at `<repo>/.venv/bin/python`.

## Build

```bash
npm run build       # TypeScript + Vite production build
npm run preview     # Serve the build locally
npm run typecheck   # tsc -b --noEmit, no emit
```

There's no production runtime story yet — the inbox is single-operator, single-machine. Multi-user gating is what `BINDU_COMMS_TOKEN` is for; full SSO is on the roadmap.

## Stack

React 19 · React Router v7 (SPA) · Vite 6 · Tailwind v4 · TanStack Query · Zustand · Phosphor icons · SQLite (events) via `better-sqlite3` · Hono on the API side.

## Attribution

Visual aesthetic inspired by [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox) (Apache 2.0). See [NOTICE](./NOTICE).
