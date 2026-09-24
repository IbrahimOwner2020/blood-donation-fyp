#!/usr/bin/env bash
# Restart the host AI service on :8000 with repo .env (LLM_PROVIDER=ollama, etc.).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/ai-service"

echo "Stopping listeners on 127.0.0.1:8000 (Python/uvicorn)..."
PIDS="$(lsof -nP -iTCP:8000 -sTCP:LISTEN -t 2>/dev/null || true)"
if [[ -n "${PIDS}" ]]; then
  # shellcheck disable=SC2086
  kill ${PIDS} 2>/dev/null || true
  sleep 1
  # shellcheck disable=SC2086
  kill -9 ${PIDS} 2>/dev/null || true
fi

echo "Starting ai-service on http://127.0.0.1:8000 ..."
exec uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
