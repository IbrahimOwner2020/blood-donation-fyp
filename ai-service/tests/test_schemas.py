"""Schema validation tests for AI service contracts."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import ForecastRequest, TrainRequest
from tests.helpers import make_history, make_training_series


def test_forecast_request_accepts_valid_payload() -> None:
    payload = ForecastRequest.model_validate(
        {
            "blood_group": "O+",
            "facility_id": "facility-001",
            "horizon_days": 7,
            "history": make_history(10),
        }
    )
    assert payload.blood_group.value == "O+"
    assert payload.horizon_days == 7
    assert len(payload.history) == 10


def test_forecast_request_accepts_60_day_horizon() -> None:
    payload = ForecastRequest.model_validate(
        {
            "blood_group": "O+",
            "horizon_days": 60,
            "history": make_history(70),
        }
    )
    assert payload.horizon_days == 60


def test_forecast_request_rejects_invalid_blood_group() -> None:
    with pytest.raises(ValidationError):
        ForecastRequest.model_validate(
            {
                "blood_group": "Z+",
                "horizon_days": 7,
                "history": make_history(5),
            }
        )


def test_forecast_request_rejects_invalid_horizon() -> None:
    with pytest.raises(ValidationError):
        ForecastRequest.model_validate(
            {
                "blood_group": "A+",
                "horizon_days": 10,
                "history": make_history(5),
            }
        )


def test_forecast_request_rejects_duplicate_dates() -> None:
    history = make_history(3)
    history.append(history[0])
    with pytest.raises(ValidationError):
        ForecastRequest.model_validate(
            {
                "blood_group": "B+",
                "horizon_days": 14,
                "history": history,
            }
        )


def test_forecast_request_accepts_preferred_model_llm() -> None:
    payload = ForecastRequest.model_validate(
        {
            "blood_group": "O+",
            "horizon_days": 7,
            "preferred_model": "llm",
            "history": make_history(10),
        }
    )
    assert payload.preferred_model == "llm"


def test_train_request_accepts_llm_candidate() -> None:
    payload = TrainRequest.model_validate(
        {
            "series": make_training_series(5),
            "candidate_models": ["llm"],
        }
    )
    assert payload.candidate_models == ["llm"]
