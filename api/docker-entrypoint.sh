#!/bin/sh
# API container entrypoint: optional migrate + seed, then start Hono.
# Env (see root .env.example / docs/17-railway-deployment.md):
#   RUN_MIGRATIONS=true|false  (default true)
#   RUN_SEED=true|false        (default false; Compose sets true for local demo)
#   SEED_DEMO_USERS=true|false (seed script; default false when NODE_ENV=production)
#   SEED_DEMO_OPERATIONS=true|false (demo donors/donations/requests/demand; same gating)
set -eu

truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

if truthy "${RUN_MIGRATIONS:-true}"; then
  echo "[api-entrypoint] running migrations..."
  bun run src/db/migrate.ts
fi

if truthy "${RUN_SEED:-false}"; then
  echo "[api-entrypoint] running seed..."
  bun run src/db/seed/index.ts
fi

echo "[api-entrypoint] starting API on port ${API_PORT:-${PORT:-3000}}..."
exec bun run src/index.ts
