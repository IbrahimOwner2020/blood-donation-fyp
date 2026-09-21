"""Forecast route and numeric shape tests."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import make_history, make_training_series


client = TestClient(app)


def test_forecast_returns_requested_horizon_and_numeric_units(
    model_dir: Path,
) -> None:
    payload = {
        "blood_group": "O+",
        "facility_id": "facility-001",
        "horizon_days": 7,
        "history": make_history(35),
    }
    response = client.post("/forecast", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["blood_group"] == "O+"
    assert body["horizon_days"] == 7
    assert body["facility_id"] == "facility-001"
    assert len(body["predictions"]) == 7
    assert isinstance(body["total_predicted_units"], (int, float))
    for point in body["predictions"]:
        assert "date" in point
        assert isinstance(point["units"], (int, float))


def test_forecast_returns_60_daily_prediction_points(model_dir: Path) -> None:
    payload = {
        "blood_group": "O+",
        "horizon_days": 60,
        "history": make_history(75),
    }
    response = client.post("/forecast", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["horizon_days"] == 60
    assert len(body["predictions"]) == 60


def test_forecast_insufficient_history_error_shape(model_dir: Path) -> None:
    payload = {
        "blood_group": "A+",
        "horizon_days": 7,
        "history": make_history(5),
    }
    response = client.post("/forecast", json=payload)
    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "INSUFFICIENT_HISTORY"
    assert "30" in body["error"]["message"]


def test_forecast_validation_error_shape(model_dir: Path) -> None:
    response = client.post(
        "/forecast",
        json={
            "blood_group": "INVALID",
            "horizon_days": 7,
            "history": make_history(5),
        },
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "message" in body["error"]


def test_forecast_uses_trained_ml_artifact(model_dir: Path) -> None:
    train_payload = {
        "series": make_training_series(45),
        "candidate_models": ["random_forest"],
    }
    train_response = client.post("/train", json=train_payload)
    assert train_response.status_code == 200
    train_body = train_response.json()
    assert train_body["selected_model"] == "random_forest"

    forecast_payload = {
        "blood_group": "O+",
        "facility_id": "facility-001",
        "horizon_days": 7,
        "history": make_history(40),
    }
    forecast_response = client.post("/forecast", json=forecast_payload)
    assert forecast_response.status_code == 200
    body = forecast_response.json()
    assert body["model"] == "random_forest"
    assert body["model_version"] == train_body["model_version"]
    assert len(body["predictions"]) == 7
    assert body["metrics"] is not None
    assert body["metrics"]["mae"] is not None
    assert all(point["units"] >= 0 for point in body["predictions"])
