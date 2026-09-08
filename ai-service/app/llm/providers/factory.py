"""Factory for configured LLM providers."""

from __future__ import annotations

from app.config import Settings, get_settings
from app.errors import AiServiceError
from app.llm.providers.base import LlmProvider
from app.llm.providers.ollama import OllamaProvider
from app.llm.providers.openai import OpenAIProvider


def get_llm_provider(settings: Settings | None = None) -> LlmProvider:
    cfg = settings or get_settings()
    provider = cfg.llm_provider

    if provider == "none":
        raise AiServiceError(
            code="LLM_NOT_CONFIGURED",
            message=(
                "LLM forecasting is not configured. Set LLM_PROVIDER=openai "
                "(requires OPENAI_API_KEY) or LLM_PROVIDER=ollama "
                "(see ai-service README / docs/15)."
            ),
            status_code=503,
        )

    if provider == "ollama":
        return OllamaProvider(
            base_url=cfg.ollama_base_url,
            model=cfg.ollama_model,
            api_key=cfg.ollama_api_key,
            timeout_seconds=cfg.llm_timeout_seconds,
        )

    if provider == "openai":
        if not cfg.openai_api_key:
            raise AiServiceError(
                code="LLM_NOT_CONFIGURED",
                message="OPENAI_API_KEY is required when LLM_PROVIDER=openai.",
                status_code=503,
            )
        return OpenAIProvider(
            api_key=cfg.openai_api_key,
            base_url=cfg.openai_base_url,
            model=cfg.openai_model,
            timeout_seconds=cfg.llm_timeout_seconds,
        )

    raise AiServiceError(
        code="LLM_NOT_CONFIGURED",
        message=f"Unsupported LLM_PROVIDER '{provider}'. Use ollama or openai.",
        status_code=503,
    )
