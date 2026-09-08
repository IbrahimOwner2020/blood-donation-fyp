# Environment and Configuration

## Root `.env.example`

See the committed [`.env.example`](../.env.example) for the full template. Key groups:

- **API / session:** `API_PORT`, `SESSION_SECRET`, `SESSION_TTL_SECONDS`, `APP_ORIGINS`, `COOKIE_SECURE`, `SESSION_COOKIE_SAME_SITE`
- **Database:** `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`
- **AI:** `AI_SERVICE_URL`, `API_INTERNAL_BASE_URL`, timeouts, `MODEL_DIR`, forecast knobs
- **Frontend:** `VITE_API_URL` (Vite **bake-time** in Docker/Railway; also `web/.env` for local Vite)
- **Bootstrap:** `RUN_MIGRATIONS`, `RUN_SEED`, `SEED_ADMIN_USER`, `SEED_DEMO_USERS`, `SEED_DEMO_OPERATIONS`
- **Demo users (local/demo only):** `DEMO_ADMIN_*`, `DEMO_OFFICER_*`
- **Mail / SMS:** `SMTP_*`, `SMS_PROVIDER`
- **LLM:** local Docker defaults to Ollama Cloud (`LLM_PROVIDER=ollama`, `OLLAMA_BASE_URL=https://ollama.com`, `OLLAMA_API_KEY`); OpenAI/Railway uses `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-4o-mini`

## Local database bootstrap (non-Docker API)

With MariaDB reachable (Docker Compose `db` or local MariaDB) and env loaded:

```bash
cp .env.example .env
cp web/.env.example web/.env
cd api
bun run db:migrate
bun run db:seed
```

`db:seed` is idempotent: blood groups, roles/permissions, donation centres, healthcare facilities, and (when allowed) demo users (Argon2id) plus demo operations (donors/donations/inventory/requests/demand). Demo passwords are for **local login only**.

| Flag | Default (unset) | Effect |
| --- | --- | --- |
| `SEED_ADMIN_USER` | off | One System Administrator from `ADMIN_*` |
| `SEED_DEMO_USERS` | on unless `NODE_ENV=production` | Demo admin/officer |
| `SEED_DEMO_OPERATIONS` | on unless `NODE_ENV=production` | Demo donors, donations→inventory, blood requests, ≥30d O+ demand |

Set both to `false` on Railway. Demo operations require an ACTIVE user for `createdBy` (usually from `SEED_DEMO_USERS`).

In Docker, the API entrypoint runs migrate/seed when `RUN_MIGRATIONS` / `RUN_SEED` are enabled — see `docs/11-docker-and-local-deployment.md`.

## Configuration Rules

- Do not commit real secrets.
- Provide safe development defaults only.
- Production / Railway: strong `SESSION_SECRET`; `COOKIE_SECURE=true`; `SESSION_COOKIE_SAME_SITE=None` when web/API are on different subdomains; `SEED_DEMO_USERS=false` and `SEED_DEMO_OPERATIONS=false` unless intentionally demoing.
- Container internal URLs use Docker/Railway service names (`DB_HOST=db`); host-side API may use `DB_HOST=127.0.0.1`.
- Host browser URLs use exposed localhost/domain ports (`VITE_API_URL`, `APP_ORIGINS`).
- Changing `VITE_API_URL` for a containerized web app requires a **web image rebuild**.

### `AI_SERVICE_URL` by runtime

| Where the API runs | `AI_SERVICE_URL` |
|--------------------|------------------|
| Host (`bun` on your machine) | `http://127.0.0.1:8000` (default in `.env.example`) |
| Docker Compose `api` service | `http://ai-service:8000` (set explicitly in `docker-compose.yml`; overrides `.env`) |
| Railway `api` | `http://ai-service.railway.internal:8000` (private DNS; see docs/17) |

Do not put `http://ai-service:8000` in a host `.env` — Docker DNS names fail outside Compose.

### `API_INTERNAL_BASE_URL` by runtime

The API passes this URL to `ai-service` so chat orchestration can call API-owned assistant tools without receiving browser cookies.

| Where services run | `API_INTERNAL_BASE_URL` |
|--------------------|-------------------------|
| Host local services | `http://127.0.0.1:3000` |
| Docker Compose | `http://api:3000` |
| Railway | Private API service URL / reference variable |

## AI Config

AI service (FastAPI) env:

```env
MODEL_DIR=/app/models
DEFAULT_FORECAST_HORIZON=7
MIN_TRAINING_ROWS=30

# LLM — local Docker default uses Ollama Cloud
LLM_PROVIDER=ollama
# Force forecast requests through Ollama for local testing; set false for statistical/ML only.
LLM_FORECAST_DEFAULT=true
LLM_TIMEOUT_SECONDS=60
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_MODEL=phi4
OLLAMA_API_KEY=
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

| Deploy | Suggested values |
|--------|------------------|
| Local Docker Ollama Cloud | `LLM_PROVIDER=ollama`, `OLLAMA_BASE_URL=https://ollama.com`, `OLLAMA_API_KEY`, `OLLAMA_MODEL`, `LLM_FORECAST_DEFAULT=true`; run `./scripts/up.sh` |
| Local Docker Ollama container | `LLM_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://ollama:11434`, `OLLAMA_MODEL=phi4`, `LLM_FORECAST_DEFAULT=true`; run `make up-llm` |
| Railway / prod | `LLM_PROVIDER=openai`, **`OPENAI_API_KEY`** from secrets, `OPENAI_MODEL=gpt-4o-mini` |
| Local with OpenAI | Same as Railway; paste key into root `.env` |
| Local without Docker | host DB/AI URLs: `DB_HOST=127.0.0.1`, `AI_SERVICE_URL=http://127.0.0.1:8000`, `OLLAMA_BASE_URL=http://localhost:11434`, web `VITE_API_URL=http://localhost:3000/api/v1` |
| Offline demo without LLM | Set `LLM_PROVIDER=none` or `LLM_FORECAST_DEFAULT=false` -> statistical/ML baselines |

Web Forecasts UI defaults the model control to **LLM**. Local Docker uses Ollama Cloud by default; Railway/prod can use OpenAI. Choose Statistical / ML to skip the LLM, or set `LLM_FORECAST_DEFAULT=false`. See `ai-service/README.md` and [`18-model-evaluation.md`](./18-model-evaluation.md).

## Configuration Ownership

API owns business thresholds such as shortage severity. AI owns model-specific configuration such as feature sets and artifact directory.

Railway: see [`docs/17-railway-deployment.md`](./17-railway-deployment.md).
