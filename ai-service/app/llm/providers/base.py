"""Shared LLM provider types."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


LLM_MODEL_NAME = "llm"


def is_llm_model(name: str | None) -> bool:
    return (name or "").strip().lower() == LLM_MODEL_NAME


@dataclass(frozen=True, slots=True)
class ChatMessage:
    role: str
    content: str


@dataclass(frozen=True, slots=True)
class LlmCompletion:
    content: str
    provider: str
    model: str


class LlmProvider(Protocol):
    """Minimal chat-completion interface used by the forecast path."""

    @property
    def provider_name(self) -> str: ...

    @property
    def model_name(self) -> str: ...

    def complete(self, messages: list[ChatMessage]) -> LlmCompletion: ...
