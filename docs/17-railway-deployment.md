# Railway Deployment

Guide for hosting **NBTS Blood AI** on [Railway](https://railway.app) using the repo Dockerfiles. No secrets are committed — configure everything in the Railway dashboard or CLI.

**Stack:** Hono/Bun API, React Router 7 web (Vite), FastAPI AI service, MariaDB.

## Recommended service layout

Create a Railway **project** with these services (from the same GitHub repo, different root directories / Dockerfiles):

| Railway service | Root / Dockerfile | Public? | Notes |
|-----------------|-------------------|---------|--------|
| `db` | Railway **MariaDB** plugin (or MySQL-compatible) | Private | Prefer plugin over self-managed MariaDB image |
| `api` | `api/Dockerfile` | Public (HTTPS) | Private networking to `db` + `ai-service` |
| `ai-service` | `ai-service/Dockerfile` | Private | Volume for `/app/models` |
| `web` | `web/Dockerfile` | Public (HTTPS) | Build-arg `VITE_API_URL` → public API URL |
| Mail | Railway SMTP / external (Resend, etc.) | — | Do **not** run Mailpit in production |

Optional: skip in-cluster Ollama on Railway (CPU/RAM heavy). **Prefer OpenAI:** set `LLM_PROVIDER=openai` (default) + **`OPENAI_API_KEY`** (+ optional `OPENAI_MODEL=gpt-4o-mini`). Ollama remains available only if you point `OLLAMA_*` at an external host and set `LLM_PROVIDER=ollama`.

```text
Browser ──HTTPS──▶ web
Browser ──HTTPS──▶ api  (/api/v1, cookies)
api ──private──▶ ai-service:8000
api ──private──▶ MariaDB
```

## One-Command CLI Deploy

Railway's Docker Registry template page is for hosting a private image registry
(`registry:2`). This app does not need that template: each service already has
its own Dockerfile, and Railway's app-code deploy path is `railway up`.

Install/auth once:

```bash
curl -fsSL agents.railway.com | sh
railway login
railway link
```

Then deploy all code services from the repo root:

```bash
SESSION_SECRET='replace-with-long-random-secret' \
DB_HOST='replace-with-railway-mysql-host' \
DB_PORT='3306' \
DB_NAME='replace-with-db-name' \
DB_USER='replace-with-db-user' \
DB_PASSWORD='replace-with-db-password' \
API_PUBLIC_URL='https://your-api.up.railway.app' \
WEB_PUBLIC_URL='https://your-web.up.railway.app' \
OLLAMA_API_KEY='replace-with-ollama-cloud-key' \
ADMIN_EMAIL='admin@example.com' \
ADMIN_PASSWORD='replace-with-temporary-admin-password' \
./scripts/deploy-railway.sh
```

The script:

- sets service variables with `railway variable set --skip-deploys`
- sends `OLLAMA_API_KEY` through stdin, not as a printed command argument
- deploys `ai-service`, `api`, and `web` with `railway up <path> --path-as-root`
- deploys in detached mode by default so one service's log stream does not block
  the next service; set `RAILWAY_ATTACH=1` to stream each deploy
- uses `api/railway.json`, `ai-service/railway.json`, and `web/railway.json`
  for healthcheck/restart config

If you already configured variables in Railway, deploy only:

```bash
RAILWAY_SKIP_VAR_SYNC=1 ./scripts/deploy-railway.sh
```

Service names default to `ai-service`, `api`, and `web`. Override them if your
Railway project uses different names:

```bash
AI_SERVICE=nbts-ai API_SERVICE=nbts-api WEB_SERVICE=nbts-web ./scripts/deploy-railway.sh
```

## Exact commands (manual sketch)

Install/auth once: `npm i -g @railway/cli` then `railway login`.

```bash
# From repo root — create project + link
railway init

# Add MariaDB plugin in dashboard (or):
railway add --database mysql
# Prefer MariaDB plugin when available in the UI.

# Create services (dashboard: New → GitHub Repo → set root directory)
#   api        → Root Directory: api
#   ai-service → Root Directory: ai-service
#   web        → Root Directory: web
# Dockerfile path: Dockerfile (default) for each.
```

Deploy after env is set:

```bash
railway up --service api
railway up --service ai-service
railway up --service web
```

Or push to the connected GitHub branch and let Railway auto-deploy.

## Environment variables

### `api`

| Variable | Example / guidance |
|----------|--------------------|
| `NODE_ENV` | `production` |
| `PORT` / `API_PORT` | Railway injects `PORT` — API already falls back to `PORT` |
| `SESSION_SECRET` | Long random secret (Railway variable, never commit) |
| `COOKIE_SECURE` | `true` |
| `SESSION_COOKIE_SAME_SITE` | `None` for Railway web/API on different subdomains |
| `APP_ORIGINS` | `https://<web-domain>` (comma-separated if multiple) |
| `DB_HOST` | MariaDB private host from plugin |
| `DB_PORT` | Plugin port (often `3306`) |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | From plugin variables |
| `AI_SERVICE_URL` | `http://ai-service.railway.internal:8000` (use Railway private DNS / reference vars) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` | Real SMTP provider |
| `SMS_PROVIDER` | `mock` until a real provider is wired |
| `RUN_MIGRATIONS` | `true` (entrypoint migrates on boot) |
| `RUN_SEED` | `true` once for reference data; can leave on (idempotent) |
| `SEED_ADMIN_USER` | `true` only when you want API boot to create one admin from `ADMIN_*` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Admin-only bootstrap user. Prefer a temporary password, then change it. |
| `SEED_DEMO_USERS` | `false` for real ops; `true` only for demo Railway apps |
| `SEED_DEMO_OPERATIONS` | `false` for real ops; `true` only when QA needs demo donors/donations/requests/demand |
| `DEMO_*` | Only if `SEED_DEMO_USERS=true` — still not real passwords in git |
| `OLLAMA_ENABLED` | `false` (Ollama not used on Railway by default) |
| `OLLAMA_MODEL` | only if using external Ollama |

Use Railway **variable references** for DB credentials from the plugin (e.g. `${{MariaDB.MYSQL_HOST}}` — exact names follow the plugin UI).

### `web` (build-time)

| Variable | Guidance |
|----------|----------|
| `VITE_API_URL` | **Build argument / build variable**: `https://<api-public-domain>/api/v1` |
| `PORT` | Railway sets automatically for `react-router-serve` |

In Railway service settings for `web`:

1. Set build variable / Docker build arg `VITE_API_URL` to the **public** API base including `/api/v1`.
2. Redeploy web whenever the API public URL changes (Vite bake-time).

Do not expect runtime-only `VITE_*` to change the client bundle.

### `ai-service`

| Variable | Guidance |
|----------|----------|
| `MODEL_DIR` | `/app/models` |
| `DEFAULT_FORECAST_HORIZON` | `7` |
| `MIN_TRAINING_ROWS` | `30` |
| `LLM_PROVIDER` | `openai` (default) |
| `OPENAI_API_KEY` | **Required** for LLM forecasts — Railway secret |
| `OPENAI_MODEL` | `gpt-4o-mini` (sensible default) |
| `OPENAI_BASE_URL` | default `https://api.openai.com/v1` |
| `LLM_FORECAST_DEFAULT` | omit (auto-true with key) or `true` |
| `OLLAMA_*` | only if forcing `LLM_PROVIDER=ollama` against an external host |

### Volumes

- Mount a Railway volume on `ai-service` at `/app/models` so trained artifacts survive restarts.
- MariaDB plugin stores data in the plugin volume — do not delete casually.

## Migrations / release command

Preferred (already in image): API **entrypoint** runs migrations when `RUN_MIGRATIONS=true`.

Alternative Railway **Release Command** (if you disable entrypoint migrate):

```bash
bun run src/db/migrate.ts
```

Seed (reference data):

```bash
bun run src/db/seed/index.ts
```

Admin user only:

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='replace-me' railway run --service api bun run db:seed:admin:runtime
```

If migrations already ran and you only want the role/admin insert:

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='replace-me' SKIP_ADMIN_MIGRATION=true railway run --service api bun run db:seed:admin:runtime
```

With `NODE_ENV=production` and unset `SEED_DEMO_USERS` / `SEED_DEMO_OPERATIONS`, demo users and demo operations are **skipped**.

## CORS / cookies checklist

1. `APP_ORIGINS` includes the exact web origin (`https://….up.railway.app` or custom domain).
2. `VITE_API_URL` points at the public API `/api/v1`.
3. `COOKIE_SECURE=true` behind HTTPS.
4. `SESSION_COOKIE_SAME_SITE=None` when web and API use different Railway subdomains.
5. Login still uses credentialed fetches — origins must match.

## What not to commit

- `.env`, production passwords, `SESSION_SECRET`, `OPENAI_API_KEY`, demo passwords used in shared environments.
- Use `.env.example` only as a template (placeholders).

## Local parity before Railway

```bash
cp .env.example .env
cp web/.env.example web/.env
docker compose config          # validate
docker compose up --build      # full stack locally
# optional LLM:
docker compose --profile llm up --build
```

## Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| Browser CORS / CSRF errors | Fix `APP_ORIGINS` to web HTTPS origin |
| Web calls wrong API host | Rebuild web with correct `VITE_API_URL` build arg |
| API cannot reach DB | Use private plugin host, not `localhost` |
| Empty roles / blood groups | Set `RUN_SEED=true` once |
| Demo login missing in prod | Expected unless `SEED_DEMO_USERS=true` |
