# Testing Strategy

**Stack:** Hono/Bun API, React Router 7 web, FastAPI AI (`uv` + pytest), Playwright E2E.

Keep these commands aligned with the root README and [`11-docker-and-local-deployment.md`](./11-docker-and-local-deployment.md):

```bash
# Full stack (optional LLM profile)
docker compose up --build          # ./scripts/up.sh | make up
./scripts/up.sh --llm              # make up-llm

# API
cd api && bun test
cd api && bun run db:migrate && bun run db:seed

# AI
cd ai-service && uv sync && uv run pytest

# Web E2E smoke (stack up + demo users)
cd web && npm install && npx playwright install chromium
cd web && npm test                   # Vitest unit tests
cd web && npm run test:e2e:smoke
cd web && npm run test:e2e:full      # mutating DoD path; needs stack up
```

## API Unit Tests

Run: `cd api && bun test`.

Test:
- validation;
- authorization;
- inventory calculations;
- shortage calculations;
- donor matching;
- blood request status rules;
- notification orchestration;
- AI client timeouts / error mapping.

## API Integration Tests

Critical path against MariaDB: `api/src/integration/critical-path.test.ts`
(auth → donors → donations → inventory → requests → predictions → alerts → notifications).
Soft-skips when DB/demo seed is unavailable.

```bash
cd api && bun run test:integration
# or: cd api && bun test
```

## Frontend Tests

Vitest covers login/session permission helpers, donor form fields, inventory/prediction
formatters, and Error/Forbidden/Loading UI states.

```bash
cd web && npm test
```

## End-to-End Tests

Use Playwright (`@playwright/test` in `web/`).

### Smoke (docs/16 demo path)

Read-only smoke in `web/e2e/demo-path.smoke.spec.ts`:

```text
Demo admin login
-> dashboard
-> donors list
-> notifications history
-> admin activity (audit stub)
```

Soft-skips when the web app or API/auth is unavailable. Does not write donors, donations, or inventory.

Prerequisites: web + API running, DB migrated and seeded with demo users (`SEED_DEMO_USERS=true`).

```bash
cd web
npm install
npx playwright install chromium
npm run test:e2e:smoke
# or: npm run test:e2e
```

Environment (optional):

| Variable | Default |
| --- | --- |
| `PLAYWRIGHT_BASE_URL` or `E2E_BASE_URL` | `http://localhost:5173` |
| `E2E_ADMIN_EMAIL` or `DEMO_ADMIN_EMAIL` | `admin@nbts.local` |
| `E2E_ADMIN_PASSWORD` or `DEMO_ADMIN_PASSWORD` | `ChangeMe-Admin-Local-Only!` |

### Full critical scenario

Mutating path in `web/e2e/demo-path.full.spec.ts`:

```text
Admin logs in
-> register donor
-> record donation
-> inspect inventory
-> create blood request
-> run forecast (when UI available)
-> alerts / shortage
-> compose + send mock notification
-> notification history + admin activity
```

```bash
cd web && npm run test:e2e:full
```

Soft-skips when the stack is down.
## AI Tests

Run: `cd ai-service && uv run pytest`. Mocked LLM provider tests always run; live Ollama is skip-unless-`OLLAMA_LIVE=1`.

### Data Tests
- required columns;
- date parsing;
- null handling;
- blood-group validation;
- no future target leakage.

### Model Tests
- training completes;
- forecast returns requested horizon;
- predictions are numeric;
- metrics generated;
- artifact can be saved and loaded.

### Evaluation
Compare each candidate against `historical_average` with time-aware MAE / RMSE / WAPE. Selection and acceptance narrative: [`18-model-evaluation.md`](./18-model-evaluation.md).

## Security Tests

- unauthenticated access rejected;
- insufficient permissions rejected;
- password hashes never returned;
- invalid IDs handled safely;
- SQL injection payloads fail validation/parameterization;
- private donor fields restricted appropriately.

## Reliability Tests

Test degraded services:
- AI service unavailable;
- email provider unavailable;
- Ollama unavailable;
- database reconnect/restart.

The core system should remain usable even when Ollama is offline.
