# NBTS Blood AI

AI-Enhanced Blood Supply Prediction and Donor Notification System for Tanzania, using NBTS as the case study.

This repository is a monorepo with three application services:

- `web/`: React Router frontend.
- `api/`: Hono API running on Bun.
- `ai-service/`: Python FastAPI forecasting service.
- `docs/`: project documentation copied from the provided documentation pack.
- `legacy-php-prototype/`: archived copy of the previous PHP prototype.

## Official Scaffold Commands Used

```bash
npx create-react-router@latest web
bun create hono@latest api --template bun --install --pm bun
uv init ai-service --bare
uv add "fastapi[standard]" pydantic pandas numpy scikit-learn joblib statsmodels pytest httpx
```

The React Router generator currently installs the latest major version by default, so the generated web app was pinned to React Router `7.18.3` afterward to match the documentation pack. The Hono command includes documented non-interactive flags so the Bun template can install without prompting in this environment.

## First boot (local)

1. Copy env templates (placeholders only — never commit real secrets):

```bash
cp .env.example .env
cp web/.env.example web/.env
```

2. **One-command full stack (Docker):**

```bash
docker compose up --build
# or: ./scripts/up.sh
# or: make up
```

The local env template uses Ollama Cloud for testable forecasts:
`LLM_PROVIDER=ollama`, `OLLAMA_BASE_URL=https://ollama.com`, and
`LLM_FORECAST_DEFAULT=true`. Paste your key into `OLLAMA_API_KEY` in `.env`
before booting the stack. To use a local Ollama container instead, set
`OLLAMA_BASE_URL=http://ollama:11434` and run `make up-llm`.

This starts web, api, ai-service, MariaDB, and Mailpit. The API container migrates and seeds on start (`RUN_MIGRATIONS` / `RUN_SEED`). Details: [`docs/11-docker-and-local-deployment.md`](./docs/11-docker-and-local-deployment.md). Railway: [`docs/17-railway-deployment.md`](./docs/17-railway-deployment.md).

3. **Or** run services on the host: start MariaDB (Compose `db` or local), set `DB_HOST=127.0.0.1` and `AI_SERVICE_URL=http://127.0.0.1:8000` for a host API (Compose overrides AI to `http://ai-service:8000` — see [`docs/15`](./docs/15-environment-and-configuration.md)), then:

```bash
cd api
bun run db:migrate
bun run db:seed
```

Seed is idempotent: blood groups, the full roles/permissions catalogue, donation centres, **demo users** (Argon2id), healthcare facilities, and (when allowed) **demo operations** (donors, donations/inventory, blood requests, O+ demand history).

The seeded RBAC catalogue includes System Administrator, Facility Manager, Donor Manager, Blood Collector, Blood Bank Manager, Doctor, Registered Donor, and compatibility roles. Re-run `bun run db:seed` after deploys so existing databases receive missing permissions such as `facilities:*`, `users:manage:facility`, and `roles:assign:facility`.

Gating (same pattern as demo users — default on in non-production, off in production unless explicitly enabled):

| Env | What it seeds |
| --- | --- |
| `SEED_ADMIN_USER=true` | One System Administrator from `ADMIN_*` |
| `SEED_DEMO_USERS=true` | Demo admin/officer accounts |
| `SEED_DEMO_OPERATIONS=true` | Demo donors / donations / inventory / requests / 35-day O+ demand |

For Railway / production-like deploys keep both `false`. Demo operations need an ACTIVE user (`createdBy`); enable demo users locally first.

4. Confirm cookie auth wiring:

- `APP_ORIGINS` includes the Vite/web origin (default `http://localhost:5173`).
- `VITE_API_URL` is `http://localhost:3000/api/v1` (root `.env` and `web/.env`; baked into Docker web image at build time).

### Demo credentials (local only)

| Role | Email | Password (placeholder) |
| --- | --- | --- |
| System Administrator | `admin@nbts.local` | `ChangeMe-Admin-Local-Only!` |
| NBTS Blood Bank Officer | `officer@nbts.local` | `ChangeMe-Officer-Local-Only!` |

Override via `DEMO_ADMIN_*` / `DEMO_OFFICER_*` in `.env` before seeding. **Do not use these outside local/dev.**

For production/demo bootstrap without the officer or demo operations, seed only
the admin:

```bash
cd api
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='replace-me' bun run db:seed:admin
```

If tables already exist and you only want to insert/role-check the admin:

```bash
cd api
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='replace-me' SKIP_ADMIN_MIGRATION=true bun run db:seed:admin
```

### Demo operational data (local/QA)

With `SEED_DEMO_OPERATIONS=true` (default in development), `bun run db:seed` also creates:

- **6 donors** (`NBTS-DEMO-D001`…`D006`) across O+/A+/B-/O-/AB+/B+, active, `POTENTIALLY_ELIGIBLE`, with phone + email
- **4 donations** → AVAILABLE inventory units (35-day shelf life), mostly assigned to seeded facilities
- **2 blood requests**: `DEMO-REQ-PENDING-O+` (PENDING) and `DEMO-REQ-APPROVED-A+` (APPROVED)
- **35 days** of SYSTEM `demand_records` for O+ at Muhimbili (enough for forecast / `MIN_TRAINING_ROWS`)

Predictions and shortage alerts are **not** seeded — run forecast from the UI after seed. Re-runs are idempotent (donor numbers, donation note markers, request soft-keys, demand date keys).

## Local Development

Run services independently:

```bash
cd web
npm run dev
```

```bash
cd api
bun run dev
```

```bash
cd ai-service
uv run fastapi dev
```

Run the full stack:

```bash
docker compose up --build
# or: ./scripts/up.sh | make up
# optional Ollama + phi4: ./scripts/up.sh --llm | make up-llm
```

Default ports:

- Web: `http://localhost:5173`
- API: `http://localhost:3000/health`
- AI service: `http://localhost:8000/health`
- Mailpit: `http://localhost:8025`
- Ollama (llm profile): `http://localhost:11434`

Docs index: [`docs/00-README.md`](./docs/00-README.md). Docker detail: [`docs/11-docker-and-local-deployment.md`](./docs/11-docker-and-local-deployment.md).

## Deploy (Railway)

See [`docs/17-railway-deployment.md`](./docs/17-railway-deployment.md) for service split, env vars, MariaDB plugin, volumes, and Vite `VITE_API_URL` build args.

## Tests

Aligned with [`docs/12-testing-strategy.md`](./docs/12-testing-strategy.md):

```bash
cd api && bun test
cd ai-service && uv sync && uv run pytest
```

### E2E smoke (Playwright)

Smoke coverage for the docs/16 demo path (login → dashboard/donors → notify → audit), read-only. Soft-skips when the stack is down.

With web + API up (and demo users seeded):

```bash
cd web
npm install
npx playwright install chromium
npm test
npm run test:e2e:smoke
npm run test:e2e:full   # mutating DoD path
```

Optional env (defaults match local demo admin and Vite):

- `PLAYWRIGHT_BASE_URL` or `E2E_BASE_URL` — web origin (`http://localhost:5173`)
- `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` — or `DEMO_ADMIN_*`

### Model evaluation

Baselines vs sklearn vs optional LLM, MAE/RMSE/WAPE, and selection rationale: [`docs/18-model-evaluation.md`](./docs/18-model-evaluation.md).

## Next Work

**Source of truth for done vs open work:** root [`TODO.md`](./TODO.md) (checklist by domain). Update checkboxes there when features land; do not rely on chat notes.

The documents under `docs/` are reference material. The API remains the business-logic authority; the AI service only owns prediction-related behavior.
