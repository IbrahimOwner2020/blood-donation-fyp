"""Training and model registry route tests."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import make_training_series


client = TestClient(app)


def test_train_baselines_and_list_models(model_dir: Path) -> None:
    payload = {
        "series": make_training_series(40),
        "candidate_models": [
            "historical_average",
            "moving_average",
            "seasonal_naive",
        ],
    }
    train_response = client.post("/train", json=payload)
    assert train_response.status_code == 200
    train_body = train_response.json()
    assert train_body["selected_model"] in {
        "historical_average",
        "moving_average",
        "seasonal_naive",
    }
    assert "model_version" in train_body
    assert "mae" in train_body["metrics"]
    assert "rmse" in train_body["baseline_metrics"]

    models_response = client.get("/models")
    assert models_response.status_code == 200
    models_body = models_response.json()
    assert len(models_body["models"]) >= 1
    model_id = models_body["models"][0]["model_id"]

    metrics_response = client.get(f"/models/{model_id}/metrics")
    assert metrics_response.status_code == 200
    metrics_body = metrics_response.json()
    assert metrics_body["model_id"] == model_id
    assert "mae" in metrics_body["metrics"]


def test_train_insufficient_history(model_dir: Path) -> None:
    payload = {
        "series": make_training_series(10),
        "candidate_models": ["moving_average"],
    }
    response = client.post("/train", json=payload)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INSUFFICIENT_HISTORY"


def test_model_metrics_not_found(model_dir: Path) -> None:
    response = client.get("/models/does-not-exist/metrics")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "MODEL_NOT_FOUND"


def test_train_selects_among_ml_and_baseline_candidates(model_dir: Path) -> None:
    payload = {
        "series": make_training_series(45),
        "candidate_models": [
            "historical_average",
            "moving_average",
            "random_forest",
            "hist_gradient_boosting",
        ],
    }
    response = client.post("/train", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["selected_model"] in {
        "historical_average",
        "moving_average",
        "random_forest",
        "hist_gradient_boosting",
    }
    assert body["metrics"]["mae"] is not None
    assert body["metrics"]["rmse"] is not None
    assert "wape" in body["metrics"]
    assert body["baseline_metrics"]["mae"] is not None

    models_response = client.get("/models")
    assert models_response.status_code == 200
    models = models_response.json()["models"]
    assert len(models) >= 1
    selected = next(
        item for item in models if item["model_version"] == body["model_version"]
    )
    assert selected["model_name"] == body["selected_model"]
    if selected["model_name"] in {"random_forest", "hist_gradient_boosting"}:
        assert "lag_1" in selected["features"]
        assert "roll_mean_7" in selected["features"]


def test_train_random_forest_only(model_dir: Path) -> None:
    payload = {
        "series": make_training_series(45),
        "candidate_models": ["random_forest"],
    }
    response = client.post("/train", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["selected_model"] == "random_forest"
    assert body["metrics"]["mae"] is not None
    assert (model_dir / f"random_forest-{body['model_version']}" / "model.joblib").is_file()
    assert (model_dir / f"random_forest-{body['model_version']}" / "metadata.json").is_file()
