# Docker and Local Deployment

## Goal

Bring up the full stack with **one command**:

```bash
cp .env.example .env
cp web/.env.example web/.env
docker compose up --build
```

Equivalents:

```bash
./scripts/up.sh
# or
make up
```

Local `.env.example` defaults to Ollama Cloud for LLM forecast testing. Paste
`OLLAMA_API_KEY` into `.env`, keep `OLLAMA_BASE_URL=https://ollama.com`, then
run:

```bash
./scripts/up.sh
# or
docker compose up --build
```

To use a local Ollama container with **phi4**, set
`OLLAMA_BASE_URL=http://ollama:11434` and enable the profile explicitly:

```bash
./scripts/up.sh --llm
# or
make up-llm
# or
docker compose --profile llm up --build
```

After LLM profile is up, `ollama-init` pulls `phi4` (override with `OLLAMA_MODEL`). To pull manually: `make pull-phi4`.

## Stack (as implemented)

| Area | Stack |
|------|--------|
| API | Hono `^4.13.5` + Bun + TypeScript, Drizzle ORM `^0.45.2`, MariaDB |
| Web | React Router `7.18.3` + React `^19` + TypeScript + Vite |
| AI | Python `>=3.12`, FastAPI, uv |

## Services

```text
web          React Router (production build) — host :5173 → container :3000
api          Hono API — :3000 (migrates + seeds on start when enabled)
ai-service   FastAPI forecasting — :8000
db           MariaDB 11 — :3306
mailpit      SMTP catcher — UI :8025, SMTP :1025
ollama       Optional (profile: llm) — :11434
ollama-init  One-shot pull of phi4 when llm profile is on
```

## Networking

Inside Compose, use **service names**, not `localhost`. The Compose `api` service sets `AI_SERVICE_URL=http://ai-service:8000` explicitly so a host-friendly root `.env` (`http://127.0.0.1:8000`) is safe to keep for local `bun` runs.

```text
API  → http://ai-service:8000
API  → db:3306
API  → mailpit:1025
API / AI → https://ollama.com    # default direct cloud API
API / AI → http://ollama:11434   # local container with the llm profile
```

Browser (on the host) calls the **published** API URL:

```text
VITE_API_URL=http://localhost:3000/api/v1
APP_ORIGINS=http://localhost:5173,http://localhost:3000
```

### Vite bake-time vs runtime

`VITE_*` variables are embedded when the **web image is built**. Changing `VITE_API_URL` in a running container does **not** update the browser bundle. Rebuild web after changing it:

```bash
docker compose build --build-arg VITE_API_URL=https://api.example.com/api/v1 web
docker compose up -d web
```

## Env wiring

1. Copy `.env.example` → `.env` (gitignored).
2. Compose loads optional `.env` for substitution and passes API vars explicitly.
3. Important keys: `APP_ORIGINS`, `SESSION_SECRET`, `DB_*`, `VITE_API_URL`, `RUN_MIGRATIONS`, `RUN_SEED`, `SEED_ADMIN_USER`, `SEED_DEMO_USERS`, `SEED_DEMO_OPERATIONS`.

Local non-Docker API against Compose DB: set `DB_HOST=127.0.0.1` in `.env` and run `cd api && bun run dev` as usual — Compose does not replace that path.

## Migrate + seed in containers

API `docker-entrypoint.sh`:

1. If `RUN_MIGRATIONS=true` (default) → `bun run src/db/migrate.ts`
2. If `RUN_SEED=true` (Compose default true) → seed blood groups, roles, centres, facilities
3. Admin user only if `SEED_ADMIN_USER=true`
4. Demo users only if `SEED_DEMO_USERS=true` or non-production default
5. Demo operations (donors/donations/requests/demand) only if `SEED_DEMO_OPERATIONS=true` or non-production default
6. Start Hono

Idempotent seeds are safe to re-run. For production-like deploys set `SEED_DEMO_USERS=false`, `SEED_DEMO_OPERATIONS=false`, and rotate `SESSION_SECRET`.

## Health checks

```text
API:        GET /health
AI service: GET /health
db:         MariaDB healthcheck.sh
ollama:     ollama list (llm profile)
```

`web` waits for `api` healthy; `api` waits for `db` + `ai-service` healthy.

## Persistent volumes

| Volume | Purpose |
|--------|---------|
| `db_data` | MariaDB data |
| `ai_models` | Forecast model artifacts (`MODEL_DIR`) |
| `ollama_data` | Ollama models (llm profile) |

Do **not** `docker compose down -v` unless you intend to wipe data — ask first in shared environments.

## Host ports (defaults)

```text
web:       http://localhost:5173
api:       http://localhost:3000/health
ai:        http://localhost:8000/health
mariadb:   localhost:3306
mailpit:   http://localhost:8025
ollama:    localhost:11434 (profile llm)
```

Override with `WEB_HOST_PORT`, `API_HOST_PORT`, etc. in `.env`.

## Host Ollama Instead of Compose Ollama

If Ibrahim already runs Ollama locally with `phi4`:

```env
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=phi4
```

Do **not** start `--profile llm` in that case, and set `OLLAMA_BASE_URL=http://host.docker.internal:11434` for containers.

## Validate Compose

```bash
docker compose config
# or
make config
```

## Demo credentials (local only)

| Role | Email | Password (placeholder) |
| --- | --- | --- |
| System Administrator | `admin@nbts.local` | `ChangeMe-Admin-Local-Only!` |
| NBTS Blood Bank Officer | `officer@nbts.local` | `ChangeMe-Officer-Local-Only!` |

Seeded when `SEED_DEMO_USERS=true`. Override via `DEMO_ADMIN_*` / `DEMO_OFFICER_*`. **Do not use outside local/dev.**

## Host-side tests (stack optional)

Aligned with root README and [`12-testing-strategy.md`](./12-testing-strategy.md):

```bash
cd api && bun test
cd ai-service && uv sync && uv run pytest
cd web && npm run test:e2e:smoke   # needs web + API + demo users
```

Model selection / MAE vs baseline: [`18-model-evaluation.md`](./18-model-evaluation.md).

## Railway

See [`17-railway-deployment.md`](./17-railway-deployment.md).
