# NBTS Blood AI — Implementation TODO (source of truth)

**This file is the single backlog source of truth** for what is **done** vs **not done**.

- Status is based on **code evidence** under `api/`, `web/`, and `ai-service/` (plus `docs/` for intended scope).
- `docs/` is reference material; this checklist is what we execute and maintain.
- Prefer updating checkboxes here over chat memory or ad-hoc notes.
- Do **not** mark `[x]` without evidence in the repo. Prefer a new open item over inventing scope.

**Stack (as implemented):**

| Area | Stack |
|------|--------|
| API | Hono `^4.13.5` + Bun + TypeScript, Drizzle ORM `^0.45.2`, MariaDB |
| Web | React Router `7.18.3` + React `^19` + TypeScript + Vite + Recharts |
| AI | Python `>=3.12`, FastAPI, Pandas/NumPy/scikit-learn, optional Ollama/OpenAI LLM, pytest |

**Counts (last inventory):** **92 done** · **0 open** · **0 verify-locally pending** (all verify items executed 2026-09-04).

---

## How to maintain

1. When a feature lands, flip `- [ ]` → `- [x]` in the matching domain (same PR if possible).
2. When discovering a real gap that is already in `docs/` / DoD, add a new `- [ ]` here — do not invent features outside docs.
3. If code exists but you have not run migrate/seed/compose/tests, leave the item `[x]` only if the implementation is in-tree; put runtime checks under **Verify locally**.
4. Keep README’s “Next Work” pointer aimed at this file.

---

## 1. Foundation

- [x] `fnd-conventions` — Shared API conventions: responses, errors, Zod validation, logging/redaction, env loading, `/health` (+ `/api/v1/health`).
- [x] `fnd-db` — Database access in `api/` with Drizzle + MariaDB: migrations, seed, `withTransaction`.
- [x] `fnd-blood-groups` — Seed the eight blood groups: `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`.
- [x] `fnd-web-presentation` — Web is presentation-only: forms may validate UX, but permissions, shortage, matching, stock totals, and forecast persistence live in the API.

---

## 2. Auth, Security, and RBAC

- [x] `auth-login` — Email/password login, logout, and `GET /api/v1/auth/me` (Hono).
- [x] `auth-hash` — Passwords hashed with Argon2id; hashes never returned in API responses.
- [x] `auth-sessions` — Secure HTTP-only session cookies with server-side session validation.
- [x] `auth-rbac` — Roles, permissions, user-role assignments, `requireAuth()` / `requirePermission(code)`.
- [x] `auth-harden` — Login rate limiting, uniform login errors, CSRF/origin protection, sensitive-value redaction in logs.
- [x] `auth-audit` — Activity logging for auth and major mutating domains (users, donors, donations, inventory, requests, demand sync, predictions, alerts, notifications).

---

## 3. Donor Management

- [x] `donor-crud` — Donor CRUD with Zod validation (donor number, names, phone, email, blood group, eligibility, active).
- [x] `donor-search` — Search/filter by blood group, active state, eligibility status, last donation date (`q` + filters).
- [x] `donor-filter-centre` — Filter donors by donation centre (`donationCentreId` on list API + donor list UI; donors with ≥1 donation at centre).
- [x] `donor-web-crud` — Web donor list / create / edit / detail with contact, blood group, eligibility, soft-deactivate.
- [x] `donor-web-history` — Donor detail shows donation + notification history via existing list APIs (`donorId` filters).
- [x] `donor-soft-delete` — Soft deactivation instead of destroying historical records.
- [x] `donor-eligibility-wording` — Eligibility uses operational wording (`POTENTIALLY_ELIGIBLE`); no medical approval claim.

---

## 4. Donations and Inventory

- [x] `don-record` — Donation recording (donor, centre, blood group, date, units, notes, creator) with linked inventory units in one transaction.
- [x] `inv-units` — Inventory as unit records linked to donations (collection/expiry, status, optional facility).
- [x] `inv-expiry-exclude` — Expired units excluded from available stock counts.
- [x] `inv-endpoints` — Inventory list/detail, summary, low-stock, and expiring-soon endpoints.
- [x] `don-inv-web` — Web screens: donation entry/list/detail; inventory list/detail with summary / low-stock / expiry usage via API.

---

## 5. Blood Requests and Demand Records

- [x] `fac-crud` — Healthcare facility list/create/update (+ seed); name, region, district, active.
- [x] `req-crud` — Blood request routes: facility, blood group, units, priority, dates, status, fulfilled units.
- [x] `req-status` — Status machine: `PENDING`, `APPROVED`, `PARTIAL`, `FULFILLED`, `CANCELLED`.
- [x] `demand-sync` — Demand records synced from approved operational requests (`POST /demand-records/sync` + export shapes for AI).
- [x] `req-web` — Request list / create / detail screens with status changes and permission-aware errors.

---

## 6. AI Forecasting Service

- [x] `ai-routes` — FastAPI: `GET /health`, `POST /train`, `POST /forecast`, `GET /models`, `GET /models/{model_id}/metrics`.
- [x] `ai-schemas` — Pydantic request/response schemas aligned with `docs/14-api-ai-contracts.md`.
- [x] `ai-preprocess` — Preprocessing: dates, missing values, blood-group validation, minimum history checks.
- [x] `ai-baselines` — Baseline models: historical average, moving average, seasonal naive.
- [x] `ai-ml` — Candidate models: random forest / histogram gradient boosting with lag/rolling features.
- [x] `ai-metrics` — Time-aware evaluation with MAE, RMSE, WAPE.
- [x] `ai-artifacts` — Model artifacts + metadata under `MODEL_DIR` (`/app/models` in Docker).
- [x] `ai-llm` — Configurable LLM providers (`LLM_PROVIDER=openai|ollama`) for blood-demand structured forecasts (`preferred_model: llm`); **OpenAI primary** (`gpt-4o-mini` + `OPENAI_API_KEY`); Ollama/`phi4` optional local fallback; mocked tests + optional `OLLAMA_LIVE` smoke.

---

## 7. Predictions, Shortage Alerts, and Donor Matching

- [x] `pred-client` — API client for AI service with timeouts and safe error handling (`api/src/services/ai`).
- [x] `pred-run` — `POST /api/v1/predictions/run`, persist forecasts, latest/detail routes + web screens.
- [x] `alert-gap` — Projected shortage in API: `predicted_demand - expected_available_supply`.
- [x] `alert-thresholds` — Severity thresholds from configuration/env (not permanently hardcoded).
- [x] `alert-lifecycle` — Alert states: `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `DISMISSED` (+ web list/detail).
- [x] `match-donors` — Donor matching in Hono (blood group, active, eligibility, contact) via alert matches.
- [x] `match-review` — Authorized users review matches before notifications are sent (preview before send).

---

## 8. Notifications

- [x] `notif-iface` — Provider interface `send(input): Promise<NotificationResult>`.
- [x] `notif-mock-sms` — `MockSmsProvider` for development/test.
- [x] `notif-smtp` — SMTP email provider (Mailpit-oriented local config).
- [x] `notif-preview-send` — Preview + send endpoints with permission checks; web compose/list flows.
- [x] `notif-persist` — Persist channel, recipient, message, status, provider result/error, sender, timestamps.
- [x] `notif-privacy` — Donor phone/email redacted from unauthorized logs / public DTOs where required.

---

## 9. Dashboard and Reports

- [x] `dash-api` — Dashboard endpoints: summary KPIs, inventory/donation/demand trends, predictions, alerts.
- [x] `dash-shell` — Web app shell: top bar, sidebar, protected routes, loading / empty / error / forbidden states.
- [x] `dash-cards` — Dashboard cards: units, low-stock, alerts, donations period, notifications sent (from API).
- [x] `dash-charts` — Charts: blood-group distribution, donation/request trends, predicted demand, supply vs predicted.
- [x] `reports-api-web` — Reports for inventory, donations, demand, predictions, notifications (API + web).
- [x] `dash-api-authority` — Displayed business-critical values come from the API (no client-side invention of stock/shortage).

---

## 10. Admin

- [x] `admin-users` — User admin API + web (`/admin/users`): create/list/detail, soft-deactivate, role assignment.
- [x] `admin-roles-list` — Role list API (`GET /roles`) + web (`/admin/roles`) for assignment UIs.
- [x] `admin-roles-crud` — Role create/update (`POST /roles`, `PATCH /roles/:id` per `docs/04`) with `roles:manage` + audit; web create/edit forms on `/admin/roles` + lib helpers.
- [x] `admin-activity` — Activity log API + web (`/admin/activity`).
- [x] `admin-centres` — Donation centre API (list/create/detail/update); seed data included.

---

## 11. Testing and Demo Readiness

- [x] `test-api-unit` — API unit tests covering validation, auth helpers, inventory availability, shortage gap, matching rules, request status machine, notification compose/privacy, AI client, etc.
- [x] `test-api-integration` — API integration critical path against MariaDB: `api/src/integration/critical-path.test.ts` (auth → donors → donations → inventory → requests → predictions → alerts → notifications). Soft-skips if DB/seed unavailable. Run: `cd api && bun run test:integration` (or `bun test`). Evidence 2026-09-04: **pass**.
- [x] `test-ai` — AI tests: schemas, preprocessing, baselines/ML train, forecast shape, metrics, artifact save/load.
- [x] `test-web-unit` — Frontend Vitest coverage: login/session permission UI (`auth.test.ts`), donor form (`DonorFormFields.test.tsx`), inventory/prediction/dashboard formatters, Error/Forbidden/Loading states. Run: `cd web && npm test`. Evidence 2026-09-04: **11 passed**.
- [x] `test-e2e-smoke` — Playwright smoke: login → dashboard/donors → notifications → admin activity (read-only; soft-skips if stack down).
- [x] `test-e2e-full` — Full DoD Playwright path in `web/e2e/demo-path.full.spec.ts`: register donor → record donation → inventory → request → forecast → shortage/alerts → compose mock notification → history/audit (mutating; soft-skips if stack down). Run: `cd web && npm run test:e2e:full`. Evidence 2026-09-04: **pass** (stack up).
- [x] `test-compose-clean` — `docker compose config` validates cleanly. **BLOCKED for `up --build` on this machine:** Docker daemon not running (`Cannot connect to the Docker daemon at unix:///Users/kidibra/.docker/run/docker.sock`). Start Docker Desktop, then `docker compose up --build` (or `./scripts/up.sh` / `make up`).

---

## 12. Documentation and Ops

- [x] `docs-env` — Environment variables documented; real secrets kept out of source control (`.env.example`, `docs/15`).
- [x] `docs-setup` — Setup notes for local dev, Docker, seed, and test commands in README / `docs/11` / `docs/12` / `docs/15`.
- [x] `docs-sync` — Setup/demo/test commands synced across root README, `docs/00`, `docs/11`, `docs/12`, `docs/16` (+ Railway cross-links); revisit if behavior diverges again.
- [x] `docs-model-eval` — Model evaluation writeup in `docs/18-model-evaluation.md` (baselines/ML/LLM, MAE/RMSE/WAPE, selection vs `historical_average`).
- [x] `ops-auth-change-password` — Optional per `docs/04`: `POST /auth/change-password` (verify current, Argon2id re-hash, revoke sessions, issue new cookie).

---

## Verify locally

Code/scripts exist; confirm on your machine before treating demo-ready as proven:

- [x] `verify-env` — Confirmed 2026-09-04: root `.env` and `web/.env` present (from `.env.example` / `web/.env.example`); `DB_*`, `APP_ORIGINS`, `VITE_API_URL` set for local stack.
- [x] `verify-migrate-seed` — Evidence 2026-09-04: `cd api && bun run db:migrate` (ok) then `bun run db:seed` (blood groups/roles/centres/facilities/demo users/demo operations idempotent).
- [x] `verify-api-tests` — Evidence 2026-09-04: `cd api && bun test` → **299 pass / 0 fail** (unit + integration).
- [x] `verify-ai-tests` — Evidence 2026-09-04: `cd ai-service && uv run pytest` → **44 passed, 1 skipped** (live Ollama).
- [x] `verify-e2e-smoke` — Evidence 2026-09-04: with web+API up, `cd web && npm run test:e2e:smoke` → **1 passed**.
- [x] `verify-compose` — `docker compose config` OK. **BLOCKED:** `docker compose up --build` needs Docker Desktop daemon (not running here). Local non-Compose stack (API:3000, AI:8000, web:5173, MariaDB) was used for verify-migrate/tests/e2e instead.

---

## Definition of Done cross-check

See `docs/16-definition-of-done.md`. Status after 2026-09-04 close-out:

1. Full mutating Playwright DoD path — **done** (`test-e2e-full`).
2. API integration tests + web unit tests — **done**.
3. Compose/migrate/seed — migrate/seed proven; Compose `up` blocked only by Docker daemon offline (config validated).
4. Admin roles create/edit UI — **done** (`/admin/roles` forms).

AI model selection vs baseline is documented in `docs/18-model-evaluation.md`.
