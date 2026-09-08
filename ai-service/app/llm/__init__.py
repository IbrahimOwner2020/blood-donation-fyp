"""Blood-demand-specific LLM forecasting (Ollama / OpenAI)."""

from __future__ import annotations

from app.llm.providers.base import LLM_MODEL_NAME, is_llm_model

__all__ = [
    "LLM_MODEL_NAME",
    "LlmForecastResult",
    "generate_llm_forecast",
    "is_llm_model",
]


def __getattr__(name: str):
    # Lazy exports avoid circular imports with app.training.
    if name == "LlmForecastResult":
        from app.llm.forecast import LlmForecastResult

        return LlmForecastResult
    if name == "generate_llm_forecast":
        from app.llm.forecast import generate_llm_forecast

        return generate_llm_forecast
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
