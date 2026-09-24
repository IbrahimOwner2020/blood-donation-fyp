#!/usr/bin/env bash
# Stop local blood-donation listeners (API, web, AI).
set -euo pipefail

PORTS=(3000 5173 5174 8000 8001)

echo "Stopping listeners on: ${PORTS[*]}"
PIDS="$(lsof -nP -iTCP:"$(IFS=,; echo "${PORTS[*]}")" -sTCP:LISTEN -t 2>/dev/null | sort -u || true)"

if [[ -z "${PIDS}" ]]; then
  echo "Nothing listening on those ports."
  exit 0
fi

echo "PIDs: ${PIDS}"
# shellcheck disable=SC2086
kill ${PIDS} 2>/dev/null || true
sleep 1

STILL="$(lsof -nP -iTCP:"$(IFS=,; echo "${PORTS[*]}")" -sTCP:LISTEN -t 2>/dev/null | sort -u || true)"
if [[ -n "${STILL}" ]]; then
  echo "Force killing: ${STILL}"
  # shellcheck disable=SC2086
  kill -9 ${STILL} 2>/dev/null || true
  sleep 1
fi

echo "Remaining:"
lsof -nP -iTCP:"$(IFS=,; echo "${PORTS[*]}")" -sTCP:LISTEN 2>/dev/null || echo "all clear"
