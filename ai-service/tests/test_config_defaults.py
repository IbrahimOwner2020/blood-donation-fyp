"""Config defaults: OpenAI primary, offline-safe LLM forecast default."""

from __future__ import annotations

import pytest

from app.config import get_settings


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_default_provider_is_openai_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_FORECAST_DEFAULT", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = get_settings()
    assert settings.llm_provider == "openai"
    assert settings.openai_model == "gpt-4o-mini"
    # No key → keep baselines for offline demos
    assert settings.llm_forecast_default is False


def test_llm_forecast_default_auto_true_with_openai_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_FORECAST_DEFAULT", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    settings = get_settings()
    assert settings.llm_provider == "openai"
    assert settings.llm_forecast_default is True
    assert settings.openai_api_key == "sk-test-not-real"


def test_explicit_llm_forecast_default_overrides_auto(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    monkeypatch.setenv("LLM_FORECAST_DEFAULT", "false")
    settings = get_settings()
    assert settings.llm_forecast_default is False


def test_ollama_provider_still_supported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("OLLAMA_API_KEY", "ollama-test-key")
    monkeypatch.delenv("LLM_FORECAST_DEFAULT", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = get_settings()
    assert settings.llm_provider == "ollama"
    assert settings.ollama_model == "phi4"
    assert settings.ollama_api_key == "ollama-test-key"
    # Ollama remains opt-in for default path unless explicitly enabled
    assert settings.llm_forecast_default is False


def test_explicit_none_disables_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "none")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    monkeypatch.delenv("LLM_FORECAST_DEFAULT", raising=False)
    settings = get_settings()
    assert settings.llm_provider == "none"
    assert settings.llm_forecast_default is False
