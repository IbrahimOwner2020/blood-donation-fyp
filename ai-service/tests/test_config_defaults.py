"""Config defaults: OpenAI is the primary chat provider."""

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
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = get_settings()
    assert settings.llm_provider == "openai"
    assert settings.openai_model == "gpt-4o-mini"


def test_openai_key_is_loaded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    settings = get_settings()
    assert settings.llm_provider == "openai"
    assert settings.openai_api_key == "sk-test-not-real"


def test_ollama_provider_still_supported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("OLLAMA_API_KEY", "ollama-test-key")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = get_settings()
    assert settings.llm_provider == "ollama"
    assert settings.ollama_model == "phi4"
    assert settings.ollama_api_key == "ollama-test-key"


def test_explicit_none_disables_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "none")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    settings = get_settings()
    assert settings.llm_provider == "none"
