# AI Data Analysis

Profile a CSV and surface the interesting columns + a chart. Agno + OpenRouter (`openai/gpt-oss-120b`) with three custom tools: `analyze_dataset` (pandas profile), `plot_chart` (matplotlib/seaborn), and `summarize_findings`.

## Setup

```bash
export OPENROUTER_API_KEY=<get one at https://openrouter.ai/keys>
uv sync --extra agents
uv pip install pandas matplotlib seaborn
```

`pandas`, `matplotlib`, and `seaborn` aren't in the `agents` extra yet — install them explicitly or boot fails on import.

## Run

```bash
uv run examples/ai-data-analysis-agent/ai_data_analysis_agent.py
# http://localhost:3773
```

## Talk to it

With `AUTH__ENABLED=false`, ask the agent to analyse a CSV that exists on the host:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Analyse /absolute/path/to/sales.csv and chart monthly revenue."}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

The artifact response contains the profile summary and a base64 PNG of the chart. With auth on, sign each body with the agent's DID key — see [`docs/AUTH.md`](../../docs/AUTH.md).
