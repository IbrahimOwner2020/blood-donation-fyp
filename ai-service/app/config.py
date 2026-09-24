"""AI service configuration loaded from environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

LlmProviderName = Literal["none", "ollama", "openai"]


def load_dotenv_files(*, override: bool = False) -> None:
    """Load repo / ai-service ``.env`` for host runs.

    Docker/Railway already inject env vars; Bun loads ``.env`` for the API.
    Uvicorn does not — call this from the FastAPI entrypoint so host processes
    pick up ``LLM_PROVIDER=ollama`` and related keys. Does not override existing
    process env unless ``override=True``.
    """
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / ".env",  # repo root
        here.parents[1] / ".env",  # ai-service/
        Path.cwd() / ".env",
    ]
    seen: set[Path] = set()
    for path in candidates:
        resolved = path.resolve()
        if resolved in seen or not resolved.is_file():
            continue
        seen.add(resolved)
        try:
            for raw_line in resolved.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if not key:
                    continue
                if not override and key in os.environ:
                    continue
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                    value = value[1:-1]
                os.environ[key] = value
        except OSError:
            continue


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _normalize_provider(raw: str | None) -> LlmProviderName:
    """Unset → openai (primary). Explicit none|off|disabled disables LLM."""
    if raw is None or raw.strip() == "":
        return "openai"
    value = raw.strip().lower()
    if value == "ollama":
        return "ollama"
    if value == "openai":
        return "openai"
    if value in {"none", "off", "disabled"}:
        return "none"
    return "none"


def _resolve_llm_forecast_default(
    provider: LlmProviderName,
    api_key: str | None,
) -> bool:
    """Prefer LLM by default when OpenAI is usable; stay offline-safe without a key.

    Explicit ``LLM_FORECAST_DEFAULT`` always wins. When unset: ``true`` only if
    provider is ``openai`` and ``OPENAI_API_KEY`` is set (Railway/prod). Local
    demos without a key keep statistical/ML baselines. Ollama remains opt-in
    via ``preferred_model=llm`` or an explicit ``LLM_FORECAST_DEFAULT=true``.
    """
    raw = os.getenv("LLM_FORECAST_DEFAULT")
    if raw is not None and raw.strip() != "":
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return provider == "openai" and bool(api_key)


@dataclass(frozen=True, slots=True)
class Settings:
    model_dir: str
    default_forecast_horizon: int
    min_training_rows: int
    llm_provider: LlmProviderName
    llm_timeout_seconds: float
    llm_forecast_default: bool
    ollama_base_url: str
    ollama_model: str
    ollama_api_key: str | None
    openai_api_key: str | None
    openai_base_url: str
    openai_model: str
    api_internal_base_url: str


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    provider = _normalize_provider(os.getenv("LLM_PROVIDER"))
    api_key_raw = os.getenv("OPENAI_API_KEY")
    api_key = api_key_raw.strip() if api_key_raw and api_key_raw.strip() else None
    ollama_api_key_raw = os.getenv("OLLAMA_API_KEY")
    ollama_api_key = (
        ollama_api_key_raw.strip()
        if ollama_api_key_raw and ollama_api_key_raw.strip()
        else None
    )
    return Settings(
        model_dir=os.getenv("MODEL_DIR", "models"),
        default_forecast_horizon=int(os.getenv("DEFAULT_FORECAST_HORIZON", "7")),
        min_training_rows=int(os.getenv("MIN_TRAINING_ROWS", "30")),
        llm_provider=provider,
        llm_timeout_seconds=_env_float("LLM_TIMEOUT_SECONDS", 60.0),
        llm_forecast_default=_resolve_llm_forecast_default(provider, api_key),
        ollama_base_url=(
            os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        ),
        ollama_model=os.getenv("OLLAMA_MODEL", "phi4").strip() or "phi4",
        ollama_api_key=ollama_api_key,
        openai_api_key=api_key,
        openai_base_url=(
            os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        ),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini",
        api_internal_base_url=(
            os.getenv("API_INTERNAL_BASE_URL", "http://localhost:3000").rstrip("/")
        ),
    )
