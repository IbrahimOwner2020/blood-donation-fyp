"""Preprocessing tests using synthetic in-memory series."""

from __future__ import annotations

from datetime import date

import pytest

from app.config import Settings
from app.errors import AiServiceError
from app.preprocessing.series import ensure_min_history, history_to_frame
from app.schemas import HistoryPoint


def test_history_to_frame_sorts_and_deduplicates() -> None:
    history = [
        HistoryPoint(date=date(2026, 1, 3), demand_units=3),
        HistoryPoint(date=date(2026, 1, 1), demand_units=1),
        HistoryPoint(date=date(2026, 1, 2), demand_units=2),
        HistoryPoint(date=date(2026, 1, 2), demand_units=9),
    ]
    frame = history_to_frame(history)
    assert list(frame["demand_units"]) == [1.0, 9.0, 3.0]


def test_ensure_min_history_raises_insufficient_history() -> None:
    frame = history_to_frame(
        [HistoryPoint(date=date(2026, 1, 1), demand_units=1.0)]
    )
    settings = Settings(
        model_dir="models",
        default_forecast_horizon=7,
        min_training_rows=30,
        llm_provider="none",
        llm_timeout_seconds=60.0,
        llm_forecast_default=False,
        ollama_base_url="http://localhost:11434",
        ollama_model="phi4",
        ollama_api_key=None,
        openai_api_key=None,
        openai_base_url="https://api.openai.com/v1",
        openai_model="gpt-4o-mini",
        api_internal_base_url="http://localhost:3000",
    )
    with pytest.raises(AiServiceError) as exc_info:
        ensure_min_history(frame, settings=settings)
    assert exc_info.value.code == "INSUFFICIENT_HISTORY"
