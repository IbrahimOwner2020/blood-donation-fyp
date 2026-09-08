#!/usr/bin/env bash
# One-command local full stack: web, api, ai-service, MariaDB, Mailpit.
# Optional LLM: WITH_LLM=1 ./scripts/up.sh   or   ./scripts/up.sh --llm
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example (placeholder secrets — change for anything beyond local demo)."
fi

if [[ ! -f web/.env ]]; then
  cp web/.env.example web/.env
  echo "Created web/.env from web/.env.example."
fi

COMPOSE_ARGS=()
PASS_THROUGH=()

for arg in "$@"; do
  case "$arg" in
    --llm)
      COMPOSE_ARGS+=(--profile llm)
      ;;
    *)
      PASS_THROUGH+=("$arg")
      ;;
  esac
done

if [[ "${WITH_LLM:-0}" == "1" ]]; then
  COMPOSE_ARGS+=(--profile llm)
fi

env_value() {
  local key="$1"
  [[ -f .env ]] || return 0
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      print
      exit
    }
  ' .env
}

ENV_LLM_PROVIDER="$(env_value LLM_PROVIDER)"
ENV_OLLAMA_ENABLED="$(env_value OLLAMA_ENABLED)"
ENV_OLLAMA_BASE_URL="$(env_value OLLAMA_BASE_URL)"

ACTIVE_OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-$ENV_OLLAMA_BASE_URL}"
if [[ "${ACTIVE_OLLAMA_BASE_URL:-}" == "http://ollama:11434" && ( "${LLM_PROVIDER:-$ENV_LLM_PROVIDER}" == "ollama" || "${OLLAMA_ENABLED:-$ENV_OLLAMA_ENABLED}" == "true" ) ]]; then
  COMPOSE_ARGS+=(--profile llm)
fi

echo "Starting stack: docker compose ${COMPOSE_ARGS[*]:-} up --build ${PASS_THROUGH[*]:-}"
exec docker compose "${COMPOSE_ARGS[@]}" up --build "${PASS_THROUGH[@]}"
