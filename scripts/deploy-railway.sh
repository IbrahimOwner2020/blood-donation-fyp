#!/usr/bin/env bash
# Deploy NBTS Blood AI to Railway from the monorepo Dockerfiles.
#
# Required services in the linked Railway project:
#   ai-service, api, web, and a MySQL/MariaDB service.
#
# Required env before running:
#   SESSION_SECRET=... \
#   DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... \
#   API_PUBLIC_URL=https://your-api.up.railway.app \
#   WEB_PUBLIC_URL=https://your-web.up.railway.app \
#   OLLAMA_API_KEY=... \
#   ADMIN_EMAIL=... ADMIN_PASSWORD=... \
#   ./scripts/deploy-railway.sh
#
# Optional:
#   RAILWAY_ENVIRONMENT=production
#   RAILWAY_PROJECT_ID=...
#   RAILWAY_ATTACH=1
#   RAILWAY_SKIP_VAR_SYNC=1
#   AI_SERVICE_URL=http://ai-service.railway.internal:8000
#   API_SERVICE=api AI_SERVICE=ai-service WEB_SERVICE=web

set -euo pipefail
set +u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_SERVICE="${API_SERVICE:-api}"
AI_SERVICE="${AI_SERVICE:-ai-service}"
WEB_SERVICE="${WEB_SERVICE:-web}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    echo "Install Railway CLI: curl -fsSL agents.railway.com | sh" >&2
    exit 1
  fi
}

read_env_file_value() {
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

value_from_env_or_file() {
  local key="$1"
  local value="${!key:-}"
  if [[ -z "$value" ]]; then
    value="$(read_env_file_value "$key")"
  fi
  printf '%s' "$value"
}

require_value() {
  local key="$1"
  local value="${!key:-}"
  if [[ -z "$value" ]]; then
    echo "Missing required environment variable: $key" >&2
    exit 1
  fi
}

railway_scope_args=()
if [[ -n "${RAILWAY_ENVIRONMENT:-}" ]]; then
  railway_scope_args+=(--environment "$RAILWAY_ENVIRONMENT")
fi

railway_up_args=("${railway_scope_args[@]}")
if [[ -n "${RAILWAY_PROJECT_ID:-}" ]]; then
  railway_up_args+=(--project "$RAILWAY_PROJECT_ID")
fi
if [[ "${RAILWAY_ATTACH:-0}" != "1" ]]; then
  railway_up_args+=(--detach)
fi

set_service_vars() {
  local service="$1"
  shift
  railway variable set "${railway_scope_args[@]}" --service "$service" --skip-deploys "$@"
}

set_service_secret_from_stdin() {
  local service="$1"
  local key="$2"
  local value="$3"
  printf '%s' "$value" | railway variable set \
    "${railway_scope_args[@]}" \
    --service "$service" \
    --skip-deploys \
    --stdin \
    "$key"
}

require_command railway

DB_HOST="${DB_HOST:-${MYSQLHOST:-}}"
DB_PORT="${DB_PORT:-${MYSQLPORT:-3306}}"
DB_NAME="${DB_NAME:-${MYSQLDATABASE:-}}"
DB_USER="${DB_USER:-${MYSQLUSER:-}}"
DB_PASSWORD="${DB_PASSWORD:-${MYSQLPASSWORD:-}}"

OLLAMA_API_KEY="$(value_from_env_or_file OLLAMA_API_KEY)"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-https://ollama.com}"
OLLAMA_MODEL="${OLLAMA_MODEL:-phi4}"
LLM_PROVIDER="${LLM_PROVIDER:-ollama}"
LLM_FORECAST_DEFAULT="${LLM_FORECAST_DEFAULT:-true}"
ADMIN_EMAIL="$(value_from_env_or_file ADMIN_EMAIL)"
ADMIN_PASSWORD="$(value_from_env_or_file ADMIN_PASSWORD)"
ADMIN_NAME="$(value_from_env_or_file ADMIN_NAME)"
ADMIN_NAME="${ADMIN_NAME:-System Administrator}"

if [[ -z "${VITE_API_URL:-}" && -n "${API_PUBLIC_URL:-}" ]]; then
  VITE_API_URL="${API_PUBLIC_URL%/}/api/v1"
fi
if [[ -z "${APP_ORIGINS:-}" && -n "${WEB_PUBLIC_URL:-}" ]]; then
  APP_ORIGINS="${WEB_PUBLIC_URL%/}"
fi

if [[ "${RAILWAY_SKIP_VAR_SYNC:-0}" != "1" ]]; then
  require_value SESSION_SECRET
  require_value DB_HOST
  require_value DB_NAME
  require_value DB_USER
  require_value DB_PASSWORD
  require_value APP_ORIGINS
  require_value VITE_API_URL

  if [[ "$LLM_PROVIDER" == "ollama" && -z "$OLLAMA_API_KEY" ]]; then
    echo "Missing OLLAMA_API_KEY for LLM_PROVIDER=ollama." >&2
    exit 1
  fi

  echo "Syncing Railway variables..."

  set_service_vars "$AI_SERVICE" \
    NODE_ENV=production \
    MODEL_DIR=/app/models \
    DEFAULT_FORECAST_HORIZON="${DEFAULT_FORECAST_HORIZON:-7}" \
    MIN_TRAINING_ROWS="${MIN_TRAINING_ROWS:-30}" \
    LLM_PROVIDER="$LLM_PROVIDER" \
    LLM_FORECAST_DEFAULT="$LLM_FORECAST_DEFAULT" \
    LLM_TIMEOUT_SECONDS="${LLM_TIMEOUT_SECONDS:-60}" \
    OLLAMA_BASE_URL="$OLLAMA_BASE_URL" \
    OLLAMA_MODEL="$OLLAMA_MODEL" \
    OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}" \
    OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o-mini}" \
    RAILWAY_HEALTHCHECK_TIMEOUT_SEC="${RAILWAY_HEALTHCHECK_TIMEOUT_SEC:-300}"

  if [[ -n "$OLLAMA_API_KEY" ]]; then
    set_service_secret_from_stdin "$AI_SERVICE" OLLAMA_API_KEY "$OLLAMA_API_KEY"
  fi
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    set_service_secret_from_stdin "$AI_SERVICE" OPENAI_API_KEY "$OPENAI_API_KEY"
  fi

  set_service_vars "$API_SERVICE" \
    NODE_ENV=production \
    SESSION_SECRET="$SESSION_SECRET" \
    SESSION_TTL_SECONDS="${SESSION_TTL_SECONDS:-604800}" \
    COOKIE_SECURE=true \
    SESSION_COOKIE_SAME_SITE="${SESSION_COOKIE_SAME_SITE:-None}" \
    APP_ORIGINS="$APP_ORIGINS" \
    DB_HOST="$DB_HOST" \
    DB_PORT="$DB_PORT" \
    DB_NAME="$DB_NAME" \
    DB_USER="$DB_USER" \
    DB_PASSWORD="$DB_PASSWORD" \
    AI_SERVICE_URL="${AI_SERVICE_URL:-http://${AI_SERVICE}.railway.internal:${AI_SERVICE_PRIVATE_PORT:-8000}}" \
    AI_REQUEST_TIMEOUT_MS="${AI_REQUEST_TIMEOUT_MS:-30000}" \
    AI_TRAIN_TIMEOUT_MS="${AI_TRAIN_TIMEOUT_MS:-120000}" \
    AI_HEALTH_TIMEOUT_MS="${AI_HEALTH_TIMEOUT_MS:-5000}" \
    SMTP_HOST="${SMTP_HOST:-smtp.example.com}" \
    SMTP_PORT="${SMTP_PORT:-587}" \
    SMTP_FROM="${SMTP_FROM:-no-reply@example.com}" \
    SMS_PROVIDER="${SMS_PROVIDER:-mock}" \
    RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}" \
    RUN_SEED="${RUN_SEED:-true}" \
    SEED_ADMIN_USER="${SEED_ADMIN_USER:-false}" \
    ADMIN_NAME="$ADMIN_NAME" \
    ADMIN_EMAIL="$ADMIN_EMAIL" \
    SEED_DEMO_USERS="${SEED_DEMO_USERS:-false}" \
    SEED_DEMO_OPERATIONS="${SEED_DEMO_OPERATIONS:-false}" \
    RAILWAY_HEALTHCHECK_TIMEOUT_SEC="${RAILWAY_HEALTHCHECK_TIMEOUT_SEC:-300}"

  if [[ -n "$ADMIN_PASSWORD" ]]; then
    set_service_secret_from_stdin "$API_SERVICE" ADMIN_PASSWORD "$ADMIN_PASSWORD"
  fi

  set_service_vars "$WEB_SERVICE" \
    NODE_ENV=production \
    VITE_API_URL="$VITE_API_URL" \
    RAILWAY_HEALTHCHECK_TIMEOUT_SEC="${RAILWAY_HEALTHCHECK_TIMEOUT_SEC:-300}"
fi

echo "Deploying $AI_SERVICE from ai-service/Dockerfile..."
railway up ./ai-service --path-as-root --service "$AI_SERVICE" "${railway_up_args[@]}"

echo "Deploying $API_SERVICE from api/Dockerfile..."
railway up ./api --path-as-root --service "$API_SERVICE" "${railway_up_args[@]}"

echo "Deploying $WEB_SERVICE from web/Dockerfile..."
railway up ./web --path-as-root --service "$WEB_SERVICE" "${railway_up_args[@]}"

cat <<EOF
Railway deploy commands completed.

If public domains do not exist yet, generate them with:
  railway domain --service $API_SERVICE
  railway domain --service $WEB_SERVICE

Then rerun this script with:
  API_PUBLIC_URL=https://<api-domain>
  WEB_PUBLIC_URL=https://<web-domain>
EOF
