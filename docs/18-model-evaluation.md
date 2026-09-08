# Model Evaluation and Selection

How the AI service chooses and justifies a forecast model for NBTS blood-demand prediction.

**Stack:** Python `>=3.12`, FastAPI, Pandas/NumPy/scikit-learn (baselines + ML); **OpenAI** LLM primary (`LLM_PROVIDER=openai`), optional Ollama. Spec: [`07-ai-service-specification.md`](./07-ai-service-specification.md). Contracts: [`14-api-ai-contracts.md`](./14-api-ai-contracts.md). Env: [`15-environment-and-configuration.md`](./15-environment-and-configuration.md), [`ai-service/README.md`](../ai-service/README.md).

## Models in scope

| Family | Names | Role |
|--------|--------|------|
| Baselines | `historical_average`, `moving_average`, `seasonal_naive` | Always available; simple, explainable references |
| ML (sklearn) | `random_forest`, `hist_gradient_boosting` | Lag/rolling feature candidates |
| LLM (optional) | `llm` | Selectable enrichment only — **not** MAE-ranked against baselines |

Default training candidates when the request omits `candidate_models`: the three baselines. Mixed train lists score baselines + ML only; an `llm`-only train writes a stub artifact (no sklearn fit).

## Metrics

Primary metrics on every scored train (persisted on artifacts and returned in `TrainResponse`):

| Metric | Meaning for blood demand |
|--------|--------------------------|
| **MAE** | Mean absolute error in units — primary **selection** key (lower is better) |
| **RMSE** | Penalizes larger misses more; useful when spikes matter |
| **WAPE** | Sum of absolute errors / sum of absolute actuals; scale-free when demand is non-zero. `null` when the actual sum is zero (MAPE-style pitfalls avoided) |

Evaluation is **time-aware**:

- Baselines: walk-forward one-step in-sample predictions (`one_step_insample_predictions`).
- ML: expanding-window walk-forward on lag/rolling feature rows (no random shuffle of time series).

Reference baseline for comparison is always **`historical_average`** (`baseline_metrics` on the train response), even when another model is selected.

## Selection rule (baselines / ML)

```text
POST /train
  → score each requested baseline/ML candidate (MAE, RMSE, WAPE)
  → sort by MAE ascending (null MAE last)
  → persist the winner under MODEL_DIR
  → return selected_model, metrics, baseline_metrics
```

A candidate is **acceptable as preferred** when it beats or meaningfully matches `historical_average` on MAE (and preferably RMSE/WAPE) on the same series and horizon assumptions. If ML does not improve on the baseline, the service correctly keeps a baseline — that is an intended, defensible outcome for short or noisy series.

## When to use which path

```text
                    ┌─────────────────────────┐
                    │ Need numeric horizon?   │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
     Sparse / short      Enough history +    Narrative /
     history, demo       lag features OK     opt-in LLM
              │                 │                 │
              ▼                 ▼                 ▼
        Baselines         Train baselines     preferred_model
        (default)         + ML; pick by MAE   = "llm" or
                                              LLM_FORECAST_DEFAULT
```

| Situation | Prefer |
|-----------|--------|
| Demo, short history (`MIN_TRAINING_ROWS` ≈ 30), explainability | Baselines (`moving_average` / `seasonal_naive` often competitive) |
| Longer daily series, lag/rolling features available | Include `random_forest` / `hist_gradient_boosting`; accept winner only if MAE ≤ baseline |
| Railway / prod (primary) | `LLM_PROVIDER=openai` + `OPENAI_API_KEY` (+ `OPENAI_MODEL=gpt-4o-mini`); LLM path auto-defaults when key is set |
| Local with OpenAI key | Same as Railway; Web Forecasts UI defaults to LLM |
| Local Ollama `phi4` | `LLM_PROVIDER=ollama`, `preferred_model: "llm"` (or `LLM_FORECAST_DEFAULT=true`) |
| Offline demo (no key) | Statistical/ML baselines; leave `OPENAI_API_KEY` empty |
| Force baselines while OpenAI configured | Pin a baseline/ML `preferred_model`, or set `LLM_FORECAST_DEFAULT=false` |

LLM forecasts still return the same `ForecastResponse` numeric shape. They are **not** trained to minimize MAE; stub train metrics mirror the historical-average baseline for transparency. Treat OpenAI LLM as the primary enrichment path when a key is present; Ollama is optional local fallback. Sklearn selection (docs/07 MAE vs baseline) still applies to trained artifacts.

## Illustrative evaluation outcomes

Exact numbers depend on the demand series passed to `/train`. The service always exposes:

1. **`metrics`** — walk-forward scores for the **selected** model.
2. **`baseline_metrics`** — scores for `historical_average` on the same series.

Acceptance narrative for demos / reports:

> Candidates were scored with time-aware MAE/RMSE/WAPE. The selected model’s MAE was less than or equal to the historical-average baseline (or the baseline itself won). Therefore the chosen model is acceptable relative to a simple reference, consistent with docs/07.

To reproduce locally (no Docker rebuild required):

```bash
cd ai-service
uv sync
uv run pytest tests/test_metrics.py tests/test_baselines.py tests/test_ml_models.py tests/test_train_models.py -q
```

Optional live Ollama smoke (skipped unless enabled):

```bash
OLLAMA_LIVE=1 uv run pytest tests/test_llm_live_ollama.py -q
```

Inspect a saved artifact after a real `/train`:

```bash
curl -s http://localhost:8000/models
curl -s "http://localhost:8000/models/<model_id>/metrics"
```

## Related commands (stack)

| Action | Command |
|--------|---------|
| Full stack | `docker compose up --build` (or `./scripts/up.sh` / `make up`) |
| Stack + Ollama/phi4 | `./scripts/up.sh --llm` / `make up-llm` |
| API unit tests | `cd api && bun test` |
| AI tests | `cd ai-service && uv run pytest` |
| E2E smoke | `cd web && npm run test:e2e:smoke` |

Setup detail: [`11-docker-and-local-deployment.md`](./11-docker-and-local-deployment.md). Testing: [`12-testing-strategy.md`](./12-testing-strategy.md). DoD: [`16-definition-of-done.md`](./16-definition-of-done.md).
