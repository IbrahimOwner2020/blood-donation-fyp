"""Ollama HTTP chat provider (local LLM)."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

import httpx

from app.errors import AiServiceError
from app.llm.providers.base import ChatMessage, LlmCompletion

# Low thinking still consumes output tokens. This budget leaves room for the
# final JSON plan or composition after that reasoning.
_GPT_OSS_NUM_PREDICT = 4096
# Ollama can return done_reason=load before a cold model generates anything.
# These pauses cover the usual gpt-oss cloud startup between attempts.
_LOAD_RETRY_DELAYS_SECONDS = (0.5, 1.0, 2.0)
_KEEP_ALIVE = "10m"


def _json_object_from_text(text: str) -> str | None:
    """Return the last JSON object embedded in model reasoning, if one exists."""
    stripped = text.strip()
    if not stripped:
        return None
    decoder = json.JSONDecoder()
    found: dict[str, Any] | None = None
    start = 0
    while start < len(stripped):
        index = stripped.find("{", start)
        if index < 0:
            break
        try:
            parsed, end = decoder.raw_decode(stripped, index)
        except json.JSONDecodeError:
            start = index + 1
            continue
        if isinstance(parsed, dict) and all(isinstance(key, str) for key in parsed):
            found = {str(key): value for key, value in parsed.items()}
        start = end
    if found is None:
        return None
    return json.dumps(found, ensure_ascii=False)


class OllamaProvider:
    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        api_key: str | None = None,
        timeout_seconds: float = 60.0,
        client: httpx.Client | None = None,
        sleeper: Callable[[float], None] | None = None,
    ) -> None:
        self._base_url = (base_url or "").rstrip("/") or "http://localhost:11434"
        self._model = (model or "").strip() or "phi4"
        self._api_key = api_key.strip() if api_key and api_key.strip() else None
        self._timeout = timeout_seconds
        self._client = client
        self._sleep = sleeper or time.sleep

    @property
    def provider_name(self) -> str:
        return "ollama"

    @property
    def model_name(self) -> str:
        return self._model

    def complete(self, messages: list[ChatMessage]) -> LlmCompletion:
        return self._complete(messages, load_attempt=0)

    def _uses_gpt_oss_thinking(self) -> bool:
        return self._model.lower().startswith("gpt-oss")

    def _generation_options(self) -> dict[str, Any]:
        options: dict[str, Any] = {"temperature": 0.1}
        if self._uses_gpt_oss_thinking():
            options["num_predict"] = _GPT_OSS_NUM_PREDICT
        return options

    def _complete(
        self,
        messages: list[ChatMessage],
        *,
        load_attempt: int,
    ) -> LlmCompletion:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": False,
            "format": "json",
            "keep_alive": _KEEP_ALIVE,
            # GPT-OSS does not accept boolean thinking controls. Keeping its
            # reasoning level low leaves room for the final JSON response.
            "think": "low" if self._uses_gpt_oss_thinking() else False,
            "options": self._generation_options(),
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
            if not content:
                tool_calls = message.get("tool_calls")
                first_call = tool_calls[0] if isinstance(tool_calls, list) and tool_calls else None
                function = first_call.get("function") if isinstance(first_call, dict) else None
                name = function.get("name") if isinstance(function, dict) else None
                arguments = function.get("arguments", {}) if isinstance(function, dict) else {}
                if isinstance(arguments, str):
                    try:
                        arguments = json.loads(arguments)
                    except json.JSONDecodeError:
                        arguments = {}
                if isinstance(name, str) and name.strip():
                    content = json.dumps(
                        {
                            "tool_call": {
                                "name": name.strip(),
                                "arguments": arguments if isinstance(arguments, dict) else {},
                            }
                        }
                    )
        if not content and isinstance(body, dict):
            raw_response = body.get("response")
            content = raw_response.strip() if isinstance(raw_response, str) else ""

        if not content:
            message_keys = sorted(message.keys()) if isinstance(message, dict) else []
            thinking = message.get("thinking") if isinstance(message, dict) else None
            done_reason = body.get("done_reason") if isinstance(body, dict) else None
            if done_reason == "load" and load_attempt < len(_LOAD_RETRY_DELAYS_SECONDS):
                self._sleep(_LOAD_RETRY_DELAYS_SECONDS[load_attempt])
                return self._complete(messages, load_attempt=load_attempt + 1)
            recovered = _json_object_from_text(thinking) if isinstance(thinking, str) else None
            if recovered:
                content = recovered
            else:
                raise AiServiceError(
                    code="LLM_INVALID_RESPONSE",
                    message=(
                        "Ollama returned an empty completion "
                        f"(done_reason={done_reason or 'unknown'}, "
                        f"message_keys={','.join(message_keys) or 'none'}, "
                        f"thinking_chars={len(thinking) if isinstance(thinking, str) else 0})."
                    ),
                    status_code=502,
                )

        return LlmCompletion(
            content=content,
            provider=self.provider_name,
            model=self._model,
        )
