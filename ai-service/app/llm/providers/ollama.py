"""Ollama HTTP chat provider (local LLM)."""

from __future__ import annotations

from typing import Any

import httpx

from app.errors import AiServiceError
from app.llm.providers.base import ChatMessage, LlmCompletion


class OllamaProvider:
    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        api_key: str | None = None,
        timeout_seconds: float = 60.0,
        client: httpx.Client | None = None,
    ) -> None:
        self._base_url = (base_url or "").rstrip("/") or "http://localhost:11434"
        self._model = (model or "").strip() or "phi4"
        self._api_key = api_key.strip() if api_key and api_key.strip() else None
        self._timeout = timeout_seconds
        self._client = client

    @property
    def provider_name(self) -> str:
        return "ollama"

    @property
    def model_name(self) -> str:
        return self._model

    def complete(self, messages: list[ChatMessage]) -> LlmCompletion:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0.1,
            },
        }
        url = f"{self._base_url}/api/chat"
        headers = (
            {"Authorization": f"Bearer {self._api_key}"}
            if self._api_key is not None
            else None
        )
        try:
            if self._client is not None:
                response = self._client.post(url, json=payload, headers=headers)
            else:
                with httpx.Client(timeout=self._timeout) as client:
                    response = client.post(url, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise AiServiceError(
                code="LLM_PROVIDER_ERROR",
                message=f"Ollama timed out after {self._timeout}s talking to {url}.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise AiServiceError(
                code="LLM_PROVIDER_ERROR",
                message=f"Ollama request failed: {exc}",
                status_code=503,
            ) from exc

        if response.status_code >= 400:
            detail = (response.text or "").strip()[:300]
            raise AiServiceError(
                code="LLM_PROVIDER_ERROR",
                message=(
                    f"Ollama returned HTTP {response.status_code}"
                    + (f": {detail}" if detail else ".")
                ),
                status_code=502,
            )

        try:
            body = response.json()
        except ValueError as exc:
            raise AiServiceError(
                code="LLM_INVALID_RESPONSE",
                message="Ollama returned a non-JSON response body.",
                status_code=502,
            ) from exc

        message = body.get("message") if isinstance(body, dict) else None
        content = ""
        if isinstance(message, dict):
            raw = message.get("content")
            content = raw.strip() if isinstance(raw, str) else ""
        if not content and isinstance(body, dict):
            raw_response = body.get("response")
            content = raw_response.strip() if isinstance(raw_response, str) else ""

        if not content:
            raise AiServiceError(
                code="LLM_INVALID_RESPONSE",
                message="Ollama returned an empty completion.",
                status_code=502,
            )

        return LlmCompletion(
            content=content,
            provider=self.provider_name,
            model=self._model,
        )
