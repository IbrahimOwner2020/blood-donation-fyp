# Definition of Done

The project is ready for final demonstration when the following are working.

Backlog status: root [`TODO.md`](../TODO.md). Local Docker: [`11-docker-and-local-deployment.md`](./11-docker-and-local-deployment.md). Railway: [`17-railway-deployment.md`](./17-railway-deployment.md). Model selection writeup: [`18-model-evaluation.md`](./18-model-evaluation.md).

## Authentication and Security
- Users can log in and log out.
- Passwords are securely hashed.
- Roles and permissions prevent unauthorized access.
- Important actions appear in activity logs.

## Donors
- Authorized users can create, view, update, and search donors.
- Blood group and contact details are stored.
- Donation history is visible.
- Eligibility-related information is represented without automated medical approval.

## Donations
- Authorized users can record donations.
- Donation history is linked to donors and centres.

## Inventory
- Blood units/stock are tracked by blood group.
- Collection and expiry dates are available.
- Expired blood is not counted as available.
- Low-stock indicators work.

## Blood Requests
- Requests can be created and updated.
- Units, blood group, facility, priority, and status are stored.

## AI Prediction
- Historical data can be prepared for forecasting.
- At least one baseline and one candidate model are evaluated (MAE/RMSE/WAPE; time-aware).
- Selected model is acceptable vs `historical_average` baseline (documented in docs/18).
- Forecast API returns predictions; optional LLM path (`preferred_model: "llm"`) keeps the same numeric shape.
- Hono persists predictions.
- Model metrics are available (`GET /models/{id}/metrics`).

## Shortage Alerts
- Predicted demand is compared to available supply.
- Gaps create visible shortage warnings.
- Severity and status are stored.

## Donor Notification
- System can identify potentially eligible registered donors for a shortage blood group.
- Authorized users can preview and send mock SMS/email notifications.
- Notification history is stored.

## Dashboard and Reporting
Dashboard shows:
- inventory;
- blood-group distribution;
- donation trend;
- demand/usage trend;
- forecasts;
- potential shortages;
- donor activity;
- notification statistics.

## Docker

The system starts from a clean machine with:

```bash
cp .env.example .env
cp web/.env.example web/.env
docker compose up --build
# equivalents: ./scripts/up.sh | make up
# optional LLM: ./scripts/up.sh --llm | make up-llm
```

Required services become healthy and the app is usable without external managed cloud services. Ollama is optional.

## Testing

Commands (see [`12-testing-strategy.md`](./12-testing-strategy.md)):

```bash
cd api && bun test
cd ai-service && uv run pytest
cd web && npm test
cd web && npm run test:e2e:smoke   # with web+API up
cd web && npm run test:e2e:full    # mutating DoD path; with web+API up
```

Done when:
- core business logic tests pass;
- AI tests pass;
- critical API integration tests pass;
- at least one full E2E workflow passes (smoke + full mutating path — see `TODO.md`).

## Final Demo Workflow

```text
Login
-> view dashboard
-> register donor
-> record donation
-> inspect inventory
-> create/view demand request
-> run AI forecast
-> see predicted shortage
-> find matching donors
-> send test notification
-> show notification/audit history
```

Demo credentials (local/dev only): `admin@nbts.local` / `ChangeMe-Admin-Local-Only!` (see root README).

If this workflow works consistently, the system satisfies the central approved project scope.
