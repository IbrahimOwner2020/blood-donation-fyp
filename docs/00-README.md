# NBTS AI-Enhanced Blood Supply Prediction System

This documentation pack defines the implementation of the final-year project:

**AI-Enhanced Blood Supply Prediction and Donor Notification System for Tanzania**  
**Case Study:** National Blood Transfusion Service (NBTS), Tanzania

## Architecture Decision

The system is implemented as three main application parts in one repository:

1. **API** — Hono + Bun + TypeScript. Owns all business logic, database access, authentication, RBAC, donor management, donations, inventory, blood requests, shortage logic, notifications, reporting, and communication with the AI service.
2. **Web** — React Router v7 + TypeScript. Owns the dashboard and all user-facing interfaces.
3. **AI Service** — Python + FastAPI + Pandas + NumPy + Scikit-learn. Owns preprocessing, training, evaluation, and forecasting.

All services are started together using Docker Compose.

## Repository Layout

```text
nbts-blood-ai/
├── api/
├── web/
├── ai-service/
├── docs/
├── docker-compose.yml
├── .env.example
└── README.md
```

## Documentation Files

- `01-project-scope-and-objectives.md` — authoritative project boundaries.
- `02-system-architecture.md` — full architecture and service responsibilities.
- `03-development-stack.md` — technologies and rationale.
- `04-api-specification.md` — Hono API modules, routes, and business rules.
- `05-frontend-specification.md` — React Router v7 routes, pages, dashboard, UX.
- `06-database-design.md` — relational data model and schema guidance.
- `07-ai-service-specification.md` — forecasting service design and API contract.
- `08-shortage-and-donor-logic.md` — shortage detection and donor matching rules.
- `09-notifications.md` — SMS/email abstraction and logging.
- `10-auth-security-and-rbac.md` — authentication, authorization, audit logging, security.
- `11-docker-and-local-deployment.md` — Docker Compose, networking, volumes, startup.
- `12-testing-strategy.md` — unit, integration, E2E, AI evaluation, and security testing.
- `13-four-week-development-plan.md` — implementation schedule.
- `14-api-ai-contracts.md` — request/response contracts between Hono and Python.
- `15-environment-and-configuration.md` — environment variables and config rules.
- `16-definition-of-done.md` — feature acceptance criteria and final project completion checklist.
- `17-railway-deployment.md` — Railway services, env vars, volumes, Vite bake-time, migrate/seed.
- `18-model-evaluation.md` — baselines vs ML vs LLM, MAE/RMSE/WAPE, selection rationale.

## Quick commands (keep in sync with root README)

```bash
# Env + full stack
cp .env.example .env && cp web/.env.example web/.env
docker compose up --build          # or: ./scripts/up.sh / make up
./scripts/up.sh --llm              # optional Ollama + phi4

# Host migrate/seed (API against MariaDB)
cd api && bun run db:migrate && bun run db:seed

# Tests
cd api && bun test
cd ai-service && uv run pytest
cd web && npm run test:e2e:smoke   # web+API up, demo users seeded
```

Demo logins and ports: root [`README.md`](../README.md). Railway: [`17-railway-deployment.md`](./17-railway-deployment.md).

## Core Engineering Principle

The **API is the system of record and business-logic authority**. The web frontend never decides critical system rules. The AI service predicts; it does not manage donors, inventory, notifications, users, or clinical decisions.
