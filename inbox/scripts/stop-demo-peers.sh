#!/usr/bin/env bash
# Stop the demo peers spawned by spawn-demo-peers.sh.
#
# Reads pids/<name>.pid for each known agent and SIGTERMs the process.
# Safe to run when nothing is running — it just reports "not running"
# per agent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="${SCRIPT_DIR}/pids"

AGENTS=("joke_agent" "poet_agent")

stop_one() {
  local name="$1"
  local pidfile="${PID_DIR}/${name}.pid"

  if [[ ! -f "${pidfile}" ]]; then
    echo "  [${name}] no pid file — not running"
    return 0
  fi

  local pid
  pid="$(cat "${pidfile}")"
  if ! ps -p "${pid}" >/dev/null 2>&1; then
    echo "  [${name}] pid ${pid} not alive — cleaning pid file"
    rm -f "${pidfile}"
    return 0
  fi

  echo "  [${name}] stopping pid=${pid}..."
  kill "${pid}" 2>/dev/null || true

  # Give it 3s to exit cleanly, then SIGKILL.
  local waited=0
  while (( waited < 3000 )); do
    if ! ps -p "${pid}" >/dev/null 2>&1; then
      rm -f "${pidfile}"
      echo "  [${name}] stopped"
      return 0
    fi
    sleep 0.25
    waited=$(( waited + 250 ))
  done

  echo "  [${name}] still alive after 3s — sending SIGKILL"
  kill -9 "${pid}" 2>/dev/null || true
  rm -f "${pidfile}"
}

echo "Stopping demo peers..."
for name in "${AGENTS[@]}"; do
  stop_one "${name}"
done
