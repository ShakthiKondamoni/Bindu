# AG2 Research Team

Three AG2 (formerly AutoGen) agents — researcher, analyst, writer — collaborate under `AutoPattern` GroupChat to produce a structured research report. LLM-driven speaker selection, not round-robin. The whole team is exposed as a single bindu agent.

## Setup

```bash
export OPENROUTER_API_KEY=<get one at https://openrouter.ai/keys>
uv sync --extra agents
```

Optional: `LLM_MODEL=openai/gpt-4o` (or any OpenRouter model) to change which model the team uses. Defaults to `openai/gpt-4o-mini`.

## Run

```bash
uv run examples/ag2_research_team/main.py
# http://localhost:3773
```

## Talk to it

With `AUTH__ENABLED=false`:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"What are the main trade-offs between Postgres and DynamoDB for a multi-tenant SaaS?"}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

Then `tasks/get` with the same `taskId`. GroupChat handoffs add latency — expect 30–90s for a real research task.

| Agent | Role |
| --- | --- |
| researcher | Gathers information on the topic. |
| analyst | Evaluates findings, identifies trade-offs. |
| writer | Produces the final structured report. |

With auth on, sign each body with the agent's DID key — see [`docs/AUTH.md`](../../docs/AUTH.md).
