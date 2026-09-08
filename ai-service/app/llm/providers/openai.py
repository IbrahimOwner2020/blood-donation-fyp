"""OpenAI Chat Completions provider (API key)."""

from __future__ import annotations

from typing import Any

import httpx

from app.errors import AiServiceError
from app.llm.providers.base import ChatMessage, LlmCompletion


class OpenAIProvider:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float = 60.0,
        client: httpx.Client | None = None,
    ) -> None:
        key = (api_key or "").strip()
        if not key:
            raise AiServiceError(
                code="LLM_NOT_CONFIGURED",
                message="OPENAI_API_KEY is required when LLM_PROVIDER=openai.",
                status_code=503,
            )
        self._api_key = key
        self._base_url = (base_url or "").rstrip("/") or "https://api.openai.com/v1"
        self._model = (model or "").strip() or "gpt-4o-mini"
        self._timeout = timeout_seconds
        self._client = client

    @property
    def provider_name(self) -> str:
        return "openai"

    @property
    def model_name(self) -> str:
        return self._model

    def complete(self, messages: list[ChatMessage]) -> LlmCompletion:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
        url = f"{self._base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        try:
            if self._client is not None:
                response = self._client.post(url, json=payload, headers=headers)
            else:
                with httpx.Client(timeout=self._timeout) as client:
                    response = client.post(url, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise AiServiceError(
                code="LLM_PROVIDER_ERROR",
                message=f"OpenAI timed out after {self._timeout}s.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise AiServiceError(
                code="LLM_PROVIDER_ERROR",
                message=f"OpenAI request failed: {exc}",
                status_code=503,
            ) from exc

        if response.status_code >= 400:
            detail = (response.text or "").strip()[:300]
            raise AiServiceError(
                code="LLM_PROVIDER_ERROR",
                message=(
                    f"OpenAI returned HTTP {response.status_code}"
                    + (f": {detail}" if detail else ".")
                ),
                status_code=502,
            )

        try:
            body = response.json()
        except ValueError as exc:
            raise AiServiceError(
                code="LLM_INVALID_RESPONSE",
                message="OpenAI returned a non-JSON response body.",
                status_code=502,
            ) from exc

        choices = body.get("choices") if isinstance(body, dict) else None
        content = ""
        if isinstance(choices, list) and choices:
            first = choices[0] if isinstance(choices[0], dict) else {}
            message = first.get("message") if isinstance(first, dict) else None
            if isinstance(message, dict):
                raw = message.get("content")
                content = raw.strip() if isinstance(raw, str) else ""

        if not content:
            raise AiServiceError(
                code="LLM_INVALID_RESPONSE",
                message="OpenAI returned an empty completion.",
                status_code=502,
            )

        return LlmCompletion(
            content=content,
            provider=self.provider_name,
            model=self._model,
        )
