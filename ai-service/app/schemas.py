"""Pydantic request/response models matching docs/14-api-ai-contracts.md."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class AssistantDataSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sourceId: str = Field(..., pattern=r"^source_[a-z0-9_]+$", max_length=64)
    tool: str = Field(..., min_length=1, max_length=120)
    arguments: dict[str, Any] = Field(default_factory=dict)


# Layout models mirror assistantCompositionPlanSchema in api/src/modules/assistant/schemas.ts.
# Keep both in sync: a layout accepted here but rejected by the API cannot be repaired.
_SOURCE_ID_PATTERN = r"^source_[a-z0-9_]+$"
_LAYOUT_ID_PATTERN = r"^[a-z][a-z0-9_-]*$"
_EXECUTABLE_KEYS = ("html", "css", "script", "url")

LayoutWidth = Literal["full", "half", "third", "two-thirds"]
LayoutFormat = Literal["text", "number", "integer", "percent", "date", "datetime"]
LayoutTone = Literal["info", "warning", "error", "success"]


class _LayoutModel(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    @model_validator(mode="before")
    @classmethod
    def reject_executable_content(cls, value: Any) -> Any:
        if isinstance(value, dict) and any(key in value for key in _EXECUTABLE_KEYS):
            raise ValueError("executable presentation content is not allowed")
        return value


class LayoutBinding(_LayoutModel):
    sourceId: str = Field(..., pattern=_SOURCE_ID_PATTERN, max_length=64)
    path: str = Field(default="", max_length=240)
    operation: Literal["value", "count", "sum", "average", "minimum", "maximum"] = "value"
    field: str | None = Field(default=None, max_length=120)


class LayoutMetricItem(_LayoutModel):
    label: str = Field(..., min_length=1, max_length=120)
    binding: LayoutBinding
    format: LayoutFormat | None = None
    comparison: str | None = Field(default=None, max_length=240)


class LayoutColumn(_LayoutModel):
    key: str = Field(..., min_length=1, max_length=120)
    label: str = Field(..., min_length=1, max_length=120)
    format: LayoutFormat | None = None


class LayoutSort(_LayoutModel):
    key: str = Field(..., min_length=1, max_length=120)
    direction: Literal["asc", "desc"]


class LayoutSeries(_LayoutModel):
    key: str = Field(..., min_length=1, max_length=120)
    label: str = Field(..., min_length=1, max_length=120)


class _LayoutBlockBase(_LayoutModel):
    id: str = Field(..., pattern=_LAYOUT_ID_PATTERN, max_length=64)
    width: LayoutWidth = "full"

    @model_validator(mode="before")
    @classmethod
    def default_required_title(cls, value: Any) -> Any:
        title_field = cls.model_fields.get("title")
        if not isinstance(value, dict) or title_field is None or not title_field.is_required():
            return value
        title = value.get("title")
        block_id = value.get("id")
        if (not isinstance(title, str) or not title.strip()) and isinstance(block_id, str) and block_id.strip():
            return {**value, "title": block_id.strip().replace("_", " ").replace("-", " ").capitalize()[:200]}
        return value


class NarrativeBlock(_LayoutBlockBase):
    type: Literal["narrative"]
    content: str = Field(..., min_length=1, max_length=4000)
    sourceIds: list[str] = Field(default_factory=list, max_length=6)


class MetricsBlock(_LayoutBlockBase):
    type: Literal["metrics"]
    title: str | None = Field(default=None, max_length=200)
    items: list[LayoutMetricItem] = Field(..., min_length=1, max_length=12)


class ComparisonBlock(_LayoutBlockBase):
    type: Literal["comparison"]
    title: str = Field(..., min_length=1, max_length=200)
    label: str = Field(..., min_length=1, max_length=120)
    current: LayoutBinding
    previous: LayoutBinding
    mode: Literal["difference", "percent_change"] = "difference"
    format: LayoutFormat | None = None


class TableBlock(_LayoutBlockBase):
    type: Literal["table"]
    title: str = Field(..., min_length=1, max_length=200)
    sourceId: str
    path: str = Field(default="", max_length=240)
    columns: list[LayoutColumn] = Field(..., min_length=1, max_length=30)
    limit: int = Field(default=200, ge=1, le=10_000)
    sort: LayoutSort | None = None


class ChartBlock(_LayoutBlockBase):
    type: Literal["chart"]
    title: str = Field(..., min_length=1, max_length=200)
    chartType: Literal["line", "bar", "stacked_bar", "area", "pie", "donut"]
    sourceId: str
    path: str = Field(default="", max_length=240)
    xKey: str = Field(..., min_length=1, max_length=120)
    series: list[LayoutSeries] = Field(..., min_length=1, max_length=8)


class RankedListBlock(_LayoutBlockBase):
    type: Literal["ranked_list"]
    title: str = Field(..., min_length=1, max_length=200)
    sourceId: str
    path: str = Field(default="", max_length=240)
    labelKey: str = Field(..., min_length=1, max_length=120)
    valueKey: str = Field(..., min_length=1, max_length=120)
    limit: int = Field(default=10, ge=1, le=50)
    direction: Literal["asc", "desc"] = "desc"


class StatusSummaryBlock(_LayoutBlockBase):
    type: Literal["status_summary"]
    title: str = Field(..., min_length=1, max_length=200)
    sourceId: str
    path: str = Field(default="", max_length=240)
    labelKey: str = Field(..., min_length=1, max_length=120)
    valueKey: str = Field(..., min_length=1, max_length=120)


class TimelineBlock(_LayoutBlockBase):
    type: Literal["timeline"]
    title: str = Field(..., min_length=1, max_length=200)
    sourceId: str
    path: str = Field(default="", max_length=240)
    dateKey: str = Field(..., min_length=1, max_length=120)
    titleKey: str = Field(..., min_length=1, max_length=120)
    detailKey: str | None = Field(default=None, max_length=120)
    limit: int = Field(default=20, ge=1, le=100)


class NoticeBlock(_LayoutBlockBase):
    type: Literal["notice"]
    tone: LayoutTone = "info"
    title: str | None = Field(default=None, max_length=160)
    message: str = Field(..., min_length=1, max_length=2000)
    sourceIds: list[str] = Field(default_factory=list, max_length=6)


class RecommendationBlock(_LayoutBlockBase):
    type: Literal["recommendation"]
    tone: LayoutTone = "info"
    title: str | None = Field(default=None, max_length=160)
    message: str = Field(..., min_length=1, max_length=2000)
    sourceIds: list[str] = Field(default_factory=list, max_length=6)


LayoutBlock = Annotated[
    NarrativeBlock
    | MetricsBlock
    | ComparisonBlock
    | TableBlock
    | ChartBlock
    | RankedListBlock
    | StatusSummaryBlock
    | TimelineBlock
    | NoticeBlock
    | RecommendationBlock,
    Field(discriminator="type"),
]


class LayoutSection(_LayoutModel):
    id: str = Field(..., pattern=_LAYOUT_ID_PATTERN, max_length=64)
    title: str | None = Field(default=None, max_length=200)
    layout: Literal["stack", "grid", "columns"] = "stack"
    blocks: list[LayoutBlock] = Field(..., min_length=1, max_length=12)


class AssistantCompositionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(..., min_length=1, max_length=220)
    summary: str = Field(..., min_length=1, max_length=2000)
    language: Literal["en", "sw"]
    sections: list[LayoutSection] = Field(..., min_length=1, max_length=12)
    suggestions: list[str] = Field(default_factory=list, max_length=8)


class AssistantChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["answer", "navigation", "permission_denied", "action_proposal", "composed_answer"]
    message: str = Field(..., min_length=1, max_length=4000)
    path: str | None = None
    requiredPermission: str | None = None
    proposal: AssistantActionProposal | None = None
    sources: list[AssistantDataSource] | None = Field(default=None, max_length=6)
    composition: AssistantCompositionPlan | None = None
    unavailableCode: str | None = Field(default=None, max_length=80)
    unavailableStage: Literal["tools", "provider", "planning", "data", "composition"] | None = None
    retryable: bool | None = None

    @model_validator(mode="after")
    def validate_composed_answer(self) -> "AssistantChatResponse":
        if self.type == "composed_answer" and (not self.sources or self.composition is None):
            raise ValueError("composed answers require sources and a composition")
        return self


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
