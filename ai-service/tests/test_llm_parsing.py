"""Unit tests for LLM forecast JSON parsing."""

from __future__ import annotations

from datetime import date

import pytest

from app.errors import AiServiceError
from app.llm.parsing import extract_json_object, parse_forecast_units


def test_extract_json_object_from_fenced_markdown() -> None:
    text = """```json
{"predictions": [{"date": "2026-02-05", "units": 3}]}
```"""
    payload = extract_json_object(text)
    assert payload["predictions"][0]["units"] == 3


def test_extract_json_object_rejects_empty() -> None:
    with pytest.raises(AiServiceError) as exc:
        extract_json_object("   ")
    assert exc.value.code == "LLM_INVALID_RESPONSE"


def test_parse_forecast_units_happy_path() -> None:
    start = date(2026, 2, 5)
    payload = {
        "blood_group": "O+",
        "horizon_days": 3,
        "predictions": [
            {"date": "2026-02-05", "units": 4},
            {"date": "2026-02-06", "units": 5.5},
            {"date": "2026-02-07", "units": "6"},
        ],
        "total_predicted_units": 15.5,
    }
    units = parse_forecast_units(
        payload,
        horizon_days=3,
        forecast_start=start,
        blood_group="O+",
    )
    assert units == [4.0, 5.5, 6.0]


def test_parse_forecast_units_rejects_vague_missing_predictions() -> None:
    with pytest.raises(AiServiceError) as exc:
        parse_forecast_units(
            {"summary": "demand may rise"},
            horizon_days=7,
            forecast_start=date(2026, 1, 1),
        )
    assert exc.value.code == "LLM_INVALID_RESPONSE"


def test_parse_forecast_units_rejects_blood_group_mismatch() -> None:
    with pytest.raises(AiServiceError) as exc:
        parse_forecast_units(
            {
                "blood_group": "A+",
                "predictions": [{"date": "2026-01-02", "units": 1}],
            },
            horizon_days=1,
            forecast_start=date(2026, 1, 2),
            blood_group="O+",
        )
    assert "blood_group" in exc.value.message


def test_parse_forecast_units_clamps_negative() -> None:
    units = parse_forecast_units(
        {"predictions": [{"date": "2026-01-02", "units": -3}]},
        horizon_days=1,
        forecast_start=date(2026, 1, 2),
    )
    assert units == [0.0]
