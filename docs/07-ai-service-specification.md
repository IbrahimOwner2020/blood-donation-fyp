# AI Service Specification

## Purpose

Provide blood-demand forecasting as an isolated Python service.

## Technology
- Python
- FastAPI
- Pydantic
- Pandas
- NumPy
- Scikit-learn
- Joblib
- Statsmodels optional

## Responsibilities

The AI service may:
- validate prediction datasets;
- clean/transform time-series data;
- create lag/rolling features;
- train candidate models;
- evaluate models;
- save model artifacts;
- load model artifacts;
- generate forecasts.

It must not:
- authenticate users;
- manage donor data;
- send notifications;
- make medical decisions;
- approve donor eligibility;
- determine application permissions.

## Suggested Structure

```text
ai-service/
├── app/
│   ├── main.py
│   ├── schemas.py
│   ├── api/
│   ├── preprocessing/
│   ├── features/
│   ├── training/
│   ├── forecasting/
│   └── evaluation/
├── models/
├── tests/
├── requirements.txt
└── Dockerfile
```

## API

```text
GET  /health
POST /train
POST /forecast
GET  /models
GET  /models/{model_id}/metrics
```

## Prediction Target

Primary target:

> Expected blood demand in units for a blood group over a future time horizon, optionally segmented by healthcare facility/service area.

Default horizons:
- 7 days;
- 14 days;
- 30 days.

## Candidate Models

Always implement a baseline before complex models.

Baselines:
- historical average;
- moving average;
- seasonal naive where data frequency supports it.

Candidate ML/statistical models:
- linear regression with time/lag features;
- Random Forest Regressor;
- HistGradientBoostingRegressor;
- exponential smoothing;
- ARIMA/SARIMA if appropriate.

Optional LLM enrichment (Ollama / OpenAI):
- selectable via `preferred_model: "llm"` on `/forecast` or train candidate `llm` (stub artifact);
- must emit structured JSON numeric series matching `ForecastResponse`;
- does not replace baseline evaluation as the default path.

## Features

Potential features:
- blood group;
- facility;
- day of week;
- month;
- week number;
- lag 1;
- lag 7;
- lag 14;
- rolling mean 7;
- rolling mean 14;
- recent request volume;
- unfulfilled demand;
- recent donation/supply level when justified.

## Evaluation

Use time-aware validation. Never randomly shuffle time-series rows for the main evaluation.

Metrics:
- MAE;
- RMSE;
- WAPE where useful;
- MAPE only when zeros are handled safely.

The selected model should beat or meaningfully improve upon a simple baseline before being described as the preferred forecasting model.

Implemented selection, when-to-use baselines vs ML vs LLM, and acceptance narrative: [`18-model-evaluation.md`](./18-model-evaluation.md).

## Model Artifacts

Store artifacts under a mounted volume:

```text
/app/models
```

Each saved model should have metadata:
- model name;
- version;
- training date;
- training date range;
- features;
- metrics;
- target;
- horizon assumptions.
