"""Pydantic request/response models matching docs/14-api-ai-contracts.md."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    service: str
    status: str


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody


class AssistantActionProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=12, max_length=120)
    action: str = Field(..., min_length=1, max_length=80)
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=1000)
    requiredPermission: str = Field(..., min_length=1, max_length=80)
    payload: dict[str, object] = Field(default_factory=dict)
    effect: str = Field(..., min_length=1, max_length=1000)


class AssistantContext(BaseModel):
    model_config = ConfigDict(extra="allow")

    pathname: str | None = Field(default=None, max_length=300)
    search: str | None = Field(default=None, max_length=800)
    filters: dict[str, object] = Field(default_factory=dict)


class AssistantToolDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    requiredPermission: str | None = None
    mutates: bool
    inputSchema: dict[str, object] = Field(default_factory=dict)


class AssistantChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(..., min_length=1, max_length=2000)
    context: AssistantContext | None = None
    history: list[dict[str, str]] = Field(default_factory=list, max_length=10)
    permissions: list[str] = Field(default_factory=list)
    toolSessionToken: str = Field(..., min_length=24, max_length=160)
    toolsUrl: str = Field(..., min_length=1)


class AssistantChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["answer", "navigation", "permission_denied", "action_proposal"]
    message: str = Field(..., min_length=1, max_length=4000)
    path: str | None = None
    requiredPermission: str | None = None
    proposal: AssistantActionProposal | None = None


class PublicChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4500)


class PublicChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(..., min_length=1, max_length=500)
    language: Literal["en", "sw"] | None = None
    turns: list[PublicChatTurn] = Field(default_factory=list, max_length=6)
    toolSessionToken: str = Field(..., min_length=24, max_length=160)
    toolsUrl: str = Field(..., min_length=1)


class PublicChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: str = Field(..., min_length=1, max_length=4000)
