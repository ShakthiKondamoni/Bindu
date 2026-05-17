#!/usr/bin/env bash
# Spawn a couple of demo peer agents so the inbox has someone to talk to.
#
# Starts two single-purpose agents from examples/gateway_test_fleet/:
#   - joke_agent on 5773  (tells jokes, declines anything else)
#   - poet_agent on 5776  (writes 4-line poems, declines anything else)
#
# Both run with AUTH__ENABLED=true so the inbox exercises its full
# Hydra-token + DID-signature path against them. Webhooks point at the
# inbox API (127.0.0.1:3787), so replies thread back automatically.
#
# Prereqs: uv on PATH, the bindu repo synced (`uv sync --dev` from
# repo root), and OPENROUTER_API_KEY exported in your shell or in
# examples/.env.
#
# Usage:
#   ./inbox/scripts/spawn-demo-peers.sh         # spawn both
#   ./inbox/scripts/stop-demo-peers.sh          # stop both
#
# After it boots it prints the URLs to paste into the inbox's
# "Contacts → + → Add a peer" flow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
PID_DIR="${SCRIPT_DIR}/pids"

mkdir -p "${LOG_DIR}" "${PID_DIR}"

# name : port : path-relative-to-repo-root
AGENTS=(
  "joke_agent:5773:examples/gateway_test_fleet/joke_agent.py"
  "poet_agent:5776:examples/gateway_test_fleet/poet_agent.py"
)

# Sanity check before we touch anything.
if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found on PATH. Install it: https://github.com/astral-sh/uv"
  exit 1
fi
if [[ -z "${OPENROUTER_API_KEY:-}" ]] && [[ ! -f "${ROOT_DIR}/examples/.env" ]]; then
  echo "OPENROUTER_API_KEY not set and ${ROOT_DIR}/examples/.env missing."
  echo "Export the key or create the .env file before running."
  exit 1
fi

start_one() {
  local name="$1" port="$2" rel_path="$3"
  local pidfile="${PID_DIR}/${name}.pid"
  local logfile="${LOG_DIR}/${name}.log"

  if [[ -f "${pidfile}" ]] && ps -p "$(cat "${pidfile}")" >/dev/null 2>&1; then
    echo "  [${name}] already running (pid=$(cat "${pidfile}")) — skip"
    return 0
  fi
  rm -f "${pidfile}"

  if lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  [${name}] port ${port} already in use — skip"
    return 0
  fi

  echo "  [${name}] starting on port ${port}..."
  (
    cd "${ROOT_DIR}"
    BINDU_PORT="${port}" \
    AUTH__ENABLED=true \
    AUTH__PROVIDER=hydra \
    nohup uv run python "${rel_path}" \
      > "${logfile}" 2>&1 &
    echo $! > "${pidfile}"
  )

  # Poll /health up to ~10s. Bindufy needs a beat to register with Hydra
  # on first boot; subsequent runs are near-instant.
  local waited=0
  while (( waited < 10000 )); do
    if curl -sS --max-time 1 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      echo "  [${name}] ready, pid=$(cat "${pidfile}"), log=${logfile}"
      return 0
    fi
    sleep 0.25
    waited=$(( waited + 250 ))
  done

  echo "  [${name}] FAILED to come up — last lines of log:"
  tail -n 20 "${logfile}" | sed 's/^/    /'
  return 1
}

echo "Spawning demo peers for the inbox..."
for entry in "${AGENTS[@]}"; do
  IFS=':' read -r name port rel_path <<< "${entry}"
  start_one "${name}" "${port}" "${rel_path}" || true
done

echo
echo "Paste these into the inbox: Contacts → + → Add a peer"
for entry in "${AGENTS[@]}"; do
  IFS=':' read -r name port _ <<< "${entry}"
  printf "  %-12s http://127.0.0.1:%s\n" "${name}" "${port}"
done

echo
echo "Stop them with:"
echo "  ${SCRIPT_DIR}/stop-demo-peers.sh"
