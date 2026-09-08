# API ↔ AI Service Contracts

## Principle

Hono owns application data. The AI service receives only prediction-relevant datasets and returns prediction outputs.

## Forecast Request

```http
POST /forecast
Content-Type: application/json
```

Example:

```json
{
  "blood_group": "O+",
  "facility_id": "facility-001",
  "horizon_days": 7,
  "history": [
    {"date": "2026-07-01", "demand_units": 8},
    {"date": "2026-07-02", "demand_units": 5}
  ]
}
```

Optional LLM enrichment (same response shape). **OpenAI is primary** (`LLM_PROVIDER=openai` + `OPENAI_API_KEY`); Ollama is optional (`LLM_PROVIDER=ollama`):

```json
{
  "blood_group": "O+",
  "horizon_days": 7,
  "preferred_model": "llm",
  "history": [
    {"date": "2026-07-01", "demand_units": 8},
    {"date": "2026-07-02", "demand_units": 5}
  ]
}
```

`preferred_model` may also pin a baseline/ML name (`moving_average`, `random_forest`, …). Omit it to use the AI default: **LLM when `OPENAI_API_KEY` is set** (auto `LLM_FORECAST_DEFAULT`), otherwise the existing artifact / baseline path.

## Forecast Response

```json
{
  "blood_group": "O+",
  "facility_id": "facility-001",
  "horizon_days": 7,
  "model": "hist_gradient_boosting",
  "model_version": "2026-09-01-01",
  "predictions": [
    {"date": "2026-09-02", "units": 7.3},
    {"date": "2026-09-03", "units": 6.8}
  ],
  "total_predicted_units": 48.6,
  "metrics": {
    "mae": 1.8,
    "rmse": 2.3
  }
}
```

## Training Request

Possible initial design:

```json
{
  "series": [
    {
      "blood_group": "O+",
      "facility_id": "facility-001",
      "date": "2026-01-01",
      "demand_units": 10
    }
  ],
  "candidate_models": [
    "moving_average",
    "random_forest",
    "hist_gradient_boosting",
    "llm"
  ]
}
```

Notes:
- `llm` is an optional candidate. Alone, training stores a stub artifact (no sklearn fit); forecasts still call the configured provider at request time.
- When mixed with baselines/ML, selection remains among numeric models only.

## Training Response

```json
{
  "selected_model": "hist_gradient_boosting",
  "model_version": "2026-09-01-01",
  "metrics": {
    "mae": 1.8,
    "rmse": 2.3
  },
  "baseline_metrics": {
    "mae": 2.7,
    "rmse": 3.5
  }
}
```

## Error Contract

```json
{
  "error": {
    "code": "INSUFFICIENT_HISTORY",
    "message": "At least 30 historical records are required for this model."
  }
}
```

LLM-specific codes (when `preferred_model` is `llm` or `LLM_FORECAST_DEFAULT=true`):

| Code | Meaning |
|------|---------|
| `LLM_NOT_CONFIGURED` | `LLM_PROVIDER` missing/disabled or OpenAI key absent |
| `LLM_PROVIDER_ERROR` | Upstream Ollama/OpenAI HTTP/timeout failure |
| `LLM_INVALID_RESPONSE` | Non-JSON / vague / non-numeric forecast rejected |

## Timeouts

Hono should use explicit timeouts.

Suggested:
- forecast: 30 seconds;
- training: longer, preferably background/manual invocation.

Never leave frontend HTTP requests waiting indefinitely for model training.
