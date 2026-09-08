# Development Stack

## Core Application

### API
- Bun
- TypeScript
- Hono
- Zod
- Drizzle ORM

### Frontend
- React
- React Router v7
- TypeScript
- TanStack Query
- React Hook Form
- Zod
- Recharts or Chart.js
- Tailwind CSS or another light styling system

### Database
- MariaDB

MariaDB is preferred because it matches the approved proposal's MySQL/MariaDB technology choice.

## AI Service
- Python 3.12+
- FastAPI
- Pydantic
- Pandas
- NumPy
- Scikit-learn
- Joblib
- Statsmodels when useful

## Local AI / LLM Testing
- **OpenAI** (primary): `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-4o-mini`
- Ollama (optional local fallback model: `phi4`)

OpenAI is the main LLM source for forecasting when an API key is set. Without a key, numeric forecasting stays on baselines / sklearn (offline-safe). Ollama remains available via `LLM_PROVIDER=ollama`. The LLM path (`preferred_model: "llm"` or auto `LLM_FORECAST_DEFAULT` with a key) must still return structured numeric horizon forecasts (docs/14).

Suitable uses:
- blood-demand horizon forecasts via OpenAI (primary) or Ollama;
- explaining forecasts;
- generating synthetic test cases;
- summarizing prediction outputs;
- drafting notification text during development.

Configure via `LLM_PROVIDER`, `OPENAI_*`, optional `OLLAMA_*` on **ai-service** (see docs/15 and `ai-service/README.md`).

## Development Email
- Mailpit

## SMS
Start with a mock provider. Implement a provider interface so a real SMS provider can be added without changing business logic.

## Infrastructure
- Docker
- Docker Compose

Optional production reverse proxy:
- Caddy

## Testing
- Bun test or Vitest for TypeScript modules
- Pytest for Python
- Playwright for E2E browser tests

## Why This Stack

It minimizes unfamiliar technology while preserving a clean AI boundary. TypeScript handles the application, Python handles numerical prediction, and Docker provides repeatable local/server deployment without managed cloud services.
