"""Forecast route tests for the LLM preferred_model path (mocked provider)."""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.llm.providers.base import LlmCompletion
from app.main import app
from tests.helpers import make_history


client = TestClient(app)


def _llm_json(horizon: int, start: date, blood_group: str = "O+") -> str:
    predictions = [
        {
            "date": (start + timedelta(days=i)).isoformat(),
            "units": 5.0 + i * 0.1,
        }
        for i in range(horizon)
    ]
    return json.dumps(
        {
            "blood_group": blood_group,
            "horizon_days": horizon,
            "predictions": predictions,
            "total_predicted_units": sum(p["units"] for p in predictions),
        }
    )


def test_forecast_with_preferred_model_llm_mocked(
    model_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    history = make_history(35)
    last = date.fromisoformat(str(history[-1]["date"]))
    start = last + timedelta(days=1)

    mock_provider = MagicMock()
    mock_provider.provider_name = "ollama"
    mock_provider.model_name = "phi4"
    mock_provider.complete.return_value = LlmCompletion(
        content=_llm_json(7, start),
        provider="ollama",
        model="phi4",
    )

    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("OLLAMA_MODEL", "phi4")
    get_settings.cache_clear()

    monkeypatch.setattr(
        "app.llm.forecast.get_llm_provider",
        lambda settings=None: mock_provider,
    )

    response = client.post(
        "/forecast",
        json={
            "blood_group": "O+",
            "facility_id": "facility-001",
            "horizon_days": 7,
            "history": history,
            "preferred_model": "llm",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "llm"
    assert body["model_version"] == "ollama:phi4"
    assert body["blood_group"] == "O+"
    assert len(body["predictions"]) == 7
    assert all(isinstance(p["units"], (int, float)) for p in body["predictions"])
    assert body["total_predicted_units"] == sum(p["units"] for p in body["predictions"])
    mock_provider.complete.assert_called_once()


def test_forecast_llm_not_configured_error(model_dir: Path) -> None:
    response = client.post(
        "/forecast",
        json={
            "blood_group": "A+",
            "horizon_days": 7,
            "history": make_history(35),
            "preferred_model": "llm",
        },
    )
    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "LLM_NOT_CONFIGURED"
