# Blood Donation Management System

AI-Enhanced Blood Supply Prediction and Donor Notification System for Tanzania, using NBTS as the case study.

This repository is a monorepo with three application services:

- `web/`: React Router frontend.
- `api/`: Hono API running on Bun.
- `ai-service/`: Python FastAPI service for the staff assistant and public chat.
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

The local env template uses Ollama Cloud for the assistant and public chat:
`LLM_PROVIDER=ollama` and `OLLAMA_BASE_URL=https://ollama.com`. Paste your key
into `OLLAMA_API_KEY` in `.env` before booting the stack. To use a local Ollama
container instead, set `OLLAMA_BASE_URL=http://ollama:11434` and run `make up-llm`.

This starts web, api, ai-service, MariaDB, and Mailpit. The API container migrates and seeds on start (`RUN_MIGRATIONS` / `RUN_SEED`). Details: [`docs/11-docker-and-local-deployment.md`](./docs/11-docker-and-local-deployment.md). Railway: [`docs/17-railway-deployment.md`](./docs/17-railway-deployment.md).

3. **Or** run services on the host: start MariaDB (Compose `db` or local), set `DB_HOST=127.0.0.1` and `AI_SERVICE_URL=http://127.0.0.1:8000` for a host API (Compose overrides AI to `http://ai-service:8000` — see [`docs/15`](./docs/15-environment-and-configuration.md)), then:

```bash
cd api
bun run db:migrate
bun run db:seed
```

Seed is idempotent for a fixed anchor: blood groups, the full roles/permissions catalogue, donation centres, **demo users** (Argon2id), healthcare facilities, and (when allowed) a **60-day demo operations dataset**.

The seeded RBAC catalogue includes System Administrator, Facility Manager, Donor Manager, Blood Collector, Blood Bank Manager, Doctor, Registered Donor, and compatibility roles. Re-run `bun run db:seed` after deploys so existing databases receive missing permissions such as `facilities:*`, `users:manage:facility`, and `roles:assign:facility`.

Gating (same pattern as demo users — default on in non-production, off in production unless explicitly enabled):

| Env | What it seeds |
| --- | --- |
| `SEED_ADMIN_USER=true` | One System Administrator from `ADMIN_*` |
| `SEED_DEMO_USERS=true` | Demo admin/officer accounts |
| `SEED_DEMO_OPERATIONS=true` | 60-day donors, donations, inventory, requests, demand, predictions, alerts, notifications, and AI-report history |
| `DEMO_DATA_AS_OF=YYYY-MM-DD` | Optional stable end date for repeatable demo datasets; defaults to today in UTC |

For Railway / production-like deploys keep both `false`. Demo operations need an ACTIVE user (`createdBy`); enable demo users locally first.

4. Confirm cookie auth wiring:

- `APP_ORIGINS` includes the Vite/web origin (default `http://localhost:5173`).
- `VITE_API_URL` is `http://localhost:3000/api/v1` (root `.env` and `web/.env`; baked into Docker web image at build time).

### Demo credentials (local only)

| Role | Email | Password (placeholder) |
| --- | --- | --- |
| Administrator | `admin@nbts.local` | `ChangeMe-Admin-Local-Only!` |
| Manager | `manager@nbts.local` | `ChangeMe-Manager-Local-Only!` |
| Blood Bank Staff | `officer@nbts.local` | `ChangeMe-Officer-Local-Only!` |

Override via `DEMO_ADMIN_*` / `DEMO_MANAGER_*` / `DEMO_OFFICER_*` in `.env` before seeding. **Do not use these outside local/dev.**

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

With `SEED_DEMO_OPERATIONS=true` (default in development), `bun run db:seed` preserves the small original examples and adds a deterministic dataset ending on `DEMO_DATA_AS_OF` or the current UTC date:

- **96 synthetic donors** covering all eight blood groups and seeded regions
- **72 donations and inventory units** across the last 60 days with coherent available, reserved, issued, expired, and discarded states
- **240 blood requests** spanning facilities, priorities, and request lifecycle statuses
- **480 imported demand points**: one daily point for every blood group over 60 complete days
- **72 weekly demo prediction snapshots**, **24 linked shortage alerts**, and **96 notification-history rows**
- **9 weekly `REPORT_ONLY` AI-analysis snapshots** for assistant and reporting demonstrations

No LLM, SMS gateway, or email provider is called. Predictions and AI-analysis rows are labelled synthetic demo history. Re-running with the same anchor inserts no duplicates.

### AI Operations Assistant

The protected `/assistant` workspace uses the configured LLM to choose up to six authorized read tools and compose a validated responsive layout from a safe component palette. The model selects the useful metrics, comparisons, tables, charts, rankings, timelines, notices, and recommendations; Hono re-runs the selected tools and resolves every displayed value from authoritative API results. Arbitrary HTML and model-supplied operational figures are rejected.

Prompts that explicitly request a report or export create an immutable version-2 snapshot. PDF follows the generated composition, while each table exposes its own formula-safe UTF-8 CSV export. Existing version-1 snapshots remain readable. If the LLM is unavailable or its layout cannot be validated, the assistant displays an unavailable state instead of substituting a fixed report.

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
