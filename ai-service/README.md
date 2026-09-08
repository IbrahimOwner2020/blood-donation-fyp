# AI Forecasting Service

Python FastAPI service for NBTS blood-demand forecasting.

**Stack:** Python `>=3.12`, FastAPI, Pandas/NumPy/scikit-learn, LLM via **OpenAI** (primary) or optional Ollama, pytest.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| POST | `/train` | Train baseline / ML / optional `llm` stub candidate |
| POST | `/forecast` | Horizon forecast (`7` / `14` / `30` days) |
| GET | `/models` | List saved artifacts |
| GET | `/models/{model_id}/metrics` | Artifact metrics |

Contracts: [`docs/14-api-ai-contracts.md`](../docs/14-api-ai-contracts.md). Selection / MAE vs baseline: [`docs/18-model-evaluation.md`](../docs/18-model-evaluation.md).

## LLM Providers

Local Docker uses Ollama Cloud as the default forecast LLM. Set `OLLAMA_API_KEY` in `.env` before running the stack. OpenAI remains available when `LLM_PROVIDER=openai` and `OPENAI_API_KEY` are set. Statistical baselines / sklearn remain available when LLM is disabled or a baseline/ML `preferred_model` is pinned.

### Configure

| Variable | Ollama Cloud | OpenAI / Railway |
|----------|--------------|------------------|
| `LLM_PROVIDER` | `ollama` | `openai` |
| `OPENAI_API_KEY` | unused | **required** |
| `OPENAI_MODEL` | unused | `gpt-4o-mini` |
| `OPENAI_BASE_URL` | unused | `https://api.openai.com/v1` |
| `OLLAMA_BASE_URL` | `https://ollama.com` | unused |
| `OLLAMA_MODEL` | your Ollama Cloud model, for example `phi4` if available to the account | unused |
| `OLLAMA_API_KEY` | **required** for direct cloud API | unused |
| `LLM_TIMEOUT_SECONDS` | `60` | `60` |
| `LLM_FORECAST_DEFAULT` | `true` for local Docker testing | unset -> auto `true` when `OPENAI_API_KEY` is set |

Also shared with sklearn path: `MODEL_DIR`, `DEFAULT_FORECAST_HORIZON`, `MIN_TRAINING_ROWS`.

### Call LLM forecast

```http
POST /forecast
Content-Type: application/json

{
  "blood_group": "O+",
  "horizon_days": 7,
  "preferred_model": "llm",
  "history": [{"date": "2026-01-01", "demand_units": 8}]
}
```

With local Docker env, forecasts without `preferred_model` use Ollama Cloud because `LLM_FORECAST_DEFAULT=true`. With OpenAI env, forecasts also use the LLM automatically when `OPENAI_API_KEY` is set unless `LLM_FORECAST_DEFAULT=false`. Pin a baseline/ML name to skip the LLM. Explicit `preferred_model: "llm"` always uses the configured provider.

Training with `"candidate_models": ["llm"]` registers a stub artifact (no sklearn fit). Mixed candidates still select among baselines/ML only.

### Local Ollama smoke

```bash
# Direct Ollama Cloud
export LLM_PROVIDER=ollama
export OLLAMA_BASE_URL=https://ollama.com
export OLLAMA_API_KEY=your_api_key
curl -s https://ollama.com/api/tags
# optional live pytest
OLLAMA_LIVE=1 uv run pytest tests/test_llm_live_ollama.py -q
```

## Develop / test

```bash
cd ai-service
uv sync
uv run pytest
```

Mocked provider tests always run. Live Ollama is skip-unless-`OLLAMA_LIVE=1`.
