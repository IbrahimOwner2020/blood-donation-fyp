"""Optional live smoke test against a local Ollama instance (phi4).

Skipped unless ``OLLAMA_LIVE=1`` is set in the environment.

Suggested check before enabling:

```bash
curl -s http://localhost:11434/api/tags
curl -s http://localhost:11434/api/chat -d '{
  "model": "phi4",
  "messages": [{"role": "user", "content": "Reply with {\\"ok\\": true} only"}],
  "stream": false,
  "format": "json"
}'
```
"""

from __future__ import annotations

import os
from datetime import date, timedelta

import pytest

from app.config import Settings, get_settings
from app.llm.forecast import generate_llm_forecast
from app.llm.providers.factory import get_llm_provider


pytestmark = pytest.mark.skipif(
    os.getenv("OLLAMA_LIVE", "").strip() not in {"1", "true", "yes"},
    reason="Set OLLAMA_LIVE=1 to run live Ollama/phi4 smoke test",
)


def test_live_ollama_phi4_forecast_numeric_series() -> None:
    get_settings.cache_clear()
    settings = Settings(
        model_dir="models",
        default_forecast_horizon=7,
        min_training_rows=30,
        llm_provider="ollama",
        llm_timeout_seconds=120.0,
        llm_forecast_default=False,
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/"),
        ollama_model=os.getenv("OLLAMA_MODEL", "phi4"),
        ollama_api_key=(
            os.getenv("OLLAMA_API_KEY").strip()
            if os.getenv("OLLAMA_API_KEY")
            else None
        ),
        openai_api_key=None,
        openai_base_url="https://api.openai.com/v1",
        openai_model="gpt-4o-mini",
        api_internal_base_url="http://localhost:3000",
    )

    provider = get_llm_provider(settings)
    assert provider.provider_name == "ollama"

    start = date(2026, 1, 1)
    dates = [start + timedelta(days=i) for i in range(35)]
    values = [5.0 + (i % 5) + (2.0 if i % 7 in {5, 6} else 0.0) for i in range(35)]

    result = generate_llm_forecast(
        blood_group="O+",
        facility_id="facility-001",
        horizon_days=7,
        history_dates=dates,
        history_values=values,
        settings=settings,
        provider=provider,
    )

    assert result.model == "llm"
    assert "ollama" in result.model_version
    assert len(result.units) == 7
    assert all(isinstance(u, float) and u >= 0 for u in result.units)
