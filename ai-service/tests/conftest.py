"""Shared pytest fixtures for the AI service."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from app.config import Settings, get_settings


@pytest.fixture()
def model_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    target = tmp_path / "models"
    target.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("MODEL_DIR", str(target))
    monkeypatch.setenv("MIN_TRAINING_ROWS", "30")
    monkeypatch.setenv("DEFAULT_FORECAST_HORIZON", "7")
    monkeypatch.setenv("LLM_PROVIDER", "none")
    monkeypatch.setenv("LLM_FORECAST_DEFAULT", "false")
    get_settings.cache_clear()
    yield target
    get_settings.cache_clear()


@pytest.fixture()
def settings(model_dir: Path) -> Settings:
    return Settings(
        model_dir=str(model_dir),
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
