from __future__ import annotations

from dataclasses import dataclass, field

from fastapi.testclient import TestClient

from app.chat.service import run_chat
from app.errors import AiServiceError
from app.llm.providers.base import ChatMessage, LlmCompletion
from app.main import app
from app.schemas import AssistantChatRequest, AssistantToolDescriptor


@dataclass
class FakeProvider:
    responses: list[str]
    messages: list[list[ChatMessage]] = field(default_factory=list)

    @property
    def provider_name(self) -> str:
        return "fake"

    @property
    def model_name(self) -> str:
        return "fake-chat"

    def complete(self, messages: list[ChatMessage]) -> LlmCompletion:
        self.messages.append(messages)
        return LlmCompletion(
            content=self.responses.pop(0),
            provider=self.provider_name,
            model=self.model_name,
        )


@dataclass
class FakeToolClient:
    result: object | None = None
    results: dict[str, object] = field(default_factory=dict)
    list_error: AiServiceError | None = None
    call_error: AiServiceError | None = None
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)
    call_errors: dict[str, AiServiceError] = field(default_factory=dict)

    def list_tools(self) -> list[AssistantToolDescriptor]:
        if self.list_error:
            raise self.list_error
        return [
            AssistantToolDescriptor(
                name="dashboard.summary",
                description="Read dashboard KPIs.",
                requiredPermission="reports:read",
                mutates=False,
                inputSchema={"type": "object"},
            ),
            AssistantToolDescriptor(
                name="dashboard.alerts",
                description="Read dashboard alerts.",
                requiredPermission="reports:read",
                mutates=False,
                inputSchema={"type": "object"},
            ),
            AssistantToolDescriptor(
                name="dashboard.predictions",
                description="Read dashboard predictions.",
                requiredPermission="reports:read",
                mutates=False,
                inputSchema={"type": "object"},
            ),
            AssistantToolDescriptor(
                name="donors.search",
                description="Search donor records.",
                requiredPermission="donors:read",
                mutates=False,
                inputSchema={"type": "object"},
            ),
            AssistantToolDescriptor(
                name="donations.search",
                description="Search donation records.",
                requiredPermission="donations:read",
                mutates=False,
                inputSchema={"type": "object"},
            ),
            AssistantToolDescriptor(
                name="predictions.propose_run",
                description="Create a forecast proposal.",
                requiredPermission="predictions:run",
                mutates=True,
                inputSchema={"type": "object"},
            ),
        ]

    def call_tool(self, name: str, arguments: dict[str, object]) -> object:
        if self.call_error:
            raise self.call_error
        if name in self.call_errors:
            raise self.call_errors[name]
        self.calls.append((name, arguments))
        if name in self.results:
            return self.results[name]
        return self.result


def chat_request(message: str = "summarize donations") -> AssistantChatRequest:
    return AssistantChatRequest(
        message=message,
        context={"pathname": "/donations", "filters": {"donorId": 12}},
        permissions=["reports:read", "alerts:read", "inventory:read", "donors:read", "donations:read", "predictions:run"],
        toolSessionToken="ast_123456789012345678901234",
        toolsUrl="http://api.test/api/v1/assistant/tools",
    )


def test_chat_returns_structured_answer_from_model() -> None:
    provider = FakeProvider(['{"type":"answer","message":"There are 3 donations in view."}'])
    result = run_chat(
        chat_request(),
        provider=provider,
        tool_client=FakeToolClient(),
    )

    assert result.type == "answer"
    assert "3 donations" in result.message
    assert "donations.search" in provider.messages[0][0].content


def test_chat_calls_api_tool_and_summarizes_result() -> None:
    provider = FakeProvider(
        [
            '{"tool_call":{"name":"donations.search","arguments":{"donorId":12}}}',
            '{"type":"answer","message":"Donor 12 has 2 recorded donations."}',
        ]
    )
    tool_client = FakeToolClient(result={"items": [{"id": 1}, {"id": 2}], "total": 2})
    result = run_chat(
        chat_request("how many donations for this donor?"),
        provider=provider,
        tool_client=tool_client,
    )

    assert result.type == "answer"
    assert result.message == "Donor 12 has 2 recorded donations."
    assert tool_client.calls == [("donations.search", {"donorId": 12})]


def test_chat_returns_action_proposal_from_tool() -> None:
    proposal = {
        "id": "act_123456789abc",
        "action": "prediction.run",
        "title": "Run forecast",
        "description": "Run O+ forecast.",
        "requiredPermission": "predictions:run",
        "payload": {"bloodGroup": "O+", "horizonDays": 7},
        "effect": "Creates a prediction after confirmation.",
    }
    provider = FakeProvider(
        ['{"tool_call":{"name":"predictions.propose_run","arguments":{"bloodGroup":"O+","horizonDays":7}}}']
    )
    tool_client = FakeToolClient(result={"proposal": proposal})

    result = run_chat(
        chat_request("run forecast for O+"),
        provider=provider,
        tool_client=tool_client,
    )

    assert result.type == "action_proposal"
    assert result.proposal is not None
    assert result.proposal.id == "act_123456789abc"


def test_chat_invalid_model_json_asks_for_specific_detail_without_page_fallback() -> None:
    provider = FakeProvider(["not-json"])
    result = run_chat(
        chat_request("can you help here?"),
        provider=provider,
        tool_client=FakeToolClient(),
    )

    assert result.type == "answer"
    assert "more specific question" in result.message
    assert "I can help with" not in result.message
    assert "/donations" not in result.message


def test_overall_system_report_fetches_permitted_tools_without_llm() -> None:
    tool_client = FakeToolClient(
        results={
            "dashboard.summary": {
                "kpis": {
                    "availableUnits": 8,
                    "lowStockGroupCount": 2,
                    "activeAlerts": 1,
                    "donationsThisPeriod": 7,
                }
            },
            "dashboard.alerts": {
                "items": [{"id": 1, "bloodGroup": "O+", "severity": "HIGH", "status": "OPEN"}],
                "total": 1,
            },
            "dashboard.predictions": {
                "items": [{"id": 2, "bloodGroup": "A+", "horizonDays": 7, "totalPredictedUnits": 12}],
                "total": 1,
            },
            "donations.search": {
                "items": [{"id": 3, "donorId": 12, "bloodGroup": "B-", "donationDate": "2026-09-01"}],
                "total": 1,
            },
            "donors.search": {
                "items": [{"id": 4, "donorNumber": "D-4", "firstName": "Amina", "bloodGroup": "O+"}],
                "total": 1,
            },
        }
    )

    result = run_chat(
        chat_request("can I get the overall report on the system"),
        tool_client=tool_client,
    )

    assert result.type == "answer"
    assert "Overall NBTS operational report" in result.message
    assert "Dashboard snapshot: 8 available units" in result.message
    assert "alert records" in result.message
    assert "prediction records" in result.message
    assert "donation records" in result.message
    assert "donor records" in result.message
    assert "more specific question" not in result.message
    assert tool_client.calls == [
        ("dashboard.summary", {}),
        ("dashboard.alerts", {"limit": 5}),
        ("dashboard.predictions", {"limit": 5}),
        ("donations.search", {"limit": 5}),
        ("donors.search", {"limit": 5}),
    ]


def test_overall_system_report_keeps_successful_sections_when_one_tool_fails() -> None:
    tool_client = FakeToolClient(
        results={
            "dashboard.summary": {
                "kpis": {
                    "availableUnits": 8,
                    "lowStockGroupCount": 2,
                    "activeAlerts": 1,
                    "donationsThisPeriod": 7,
                }
            }
        },
        call_errors={
            "dashboard.alerts": AiServiceError(
                code="API_TOOL_ERROR",
                message="alerts unavailable",
                status_code=503,
            )
        },
    )

    result = run_chat(
        chat_request("overall report on the system"),
        tool_client=tool_client,
    )

    assert result.type == "answer"
    assert "Dashboard snapshot: 8 available units" in result.message
    assert "dashboard.alerts: this section is unavailable right now." in result.message
    assert "cannot access live NBTS data" not in result.message


def test_tool_list_failure_returns_data_unavailable_message() -> None:
    result = run_chat(
        chat_request("summarize donations"),
        provider=FakeProvider(['{"type":"answer","message":"unused"}']),
        tool_client=FakeToolClient(
            list_error=AiServiceError(
                code="API_TOOL_UNAVAILABLE",
                message="tool service down",
                status_code=503,
            )
        ),
    )

    assert result.type == "answer"
    assert "cannot access live NBTS data" in result.message
    assert "I can help with" not in result.message


def test_tool_call_failure_returns_data_unavailable_message() -> None:
    provider = FakeProvider(
        ['{"tool_call":{"name":"donations.search","arguments":{"donorId":12}}}']
    )
    result = run_chat(
        chat_request("show this donor donations"),
        provider=provider,
        tool_client=FakeToolClient(
            call_error=AiServiceError(
                code="API_TOOL_UNAVAILABLE",
                message="tool call down",
                status_code=503,
            )
        ),
    )

    assert result.type == "answer"
    assert "cannot access live NBTS data" in result.message


def test_tool_permission_denial_returns_plain_access_message() -> None:
    provider = FakeProvider(
        ['{"tool_call":{"name":"donations.search","arguments":{"donorId":12}}}']
    )
    result = run_chat(
        chat_request("show this donor donations"),
        provider=provider,
        tool_client=FakeToolClient(
            call_error=AiServiceError(
                code="FORBIDDEN",
                message="Your account cannot access donation records.",
                status_code=403,
            )
        ),
    )

    assert result.type == "permission_denied"
    assert result.message == "Your account cannot access donation records."


def test_tool_result_fallback_formats_records_without_raw_json() -> None:
    provider = FakeProvider(
        [
            '{"tool_call":{"name":"donations.search","arguments":{"donorId":12}}}',
            "not-json",
        ]
    )
    tool_client = FakeToolClient(
        result={
            "items": [
                {
                    "id": 1,
                    "donorId": 12,
                    "bloodGroup": "O+",
                    "unitsCollected": 1,
                    "status": "TESTED",
                }
            ],
            "total": 1,
        }
    )
    result = run_chat(
        chat_request("show this donor donations"),
        provider=provider,
        tool_client=tool_client,
    )

    assert result.type == "answer"
    assert "I found 1 donation records." in result.message
    assert "{" not in result.message
    assert "}" not in result.message


def test_chat_without_llm_still_uses_tools_for_known_actions() -> None:
    proposal = {
        "id": "act_123456789abc",
        "action": "prediction.run",
        "title": "Run forecast",
        "description": "Run O+ forecast.",
        "requiredPermission": "predictions:run",
        "payload": {"bloodGroup": "O+", "horizonDays": 14},
        "effect": "Creates a prediction after confirmation.",
    }
    tool_client = FakeToolClient(result={"proposal": proposal})

    result = run_chat(
        chat_request("run a 14 day forecast for O+"),
        tool_client=tool_client,
    )

    assert result.type == "action_proposal"
    assert result.proposal is not None
    assert result.proposal.payload["horizonDays"] == 14
    assert tool_client.calls == [
        ("predictions.propose_run", {"bloodGroup": "O+", "horizonDays": 14})
    ]


def test_chat_endpoint_validates_request_shape() -> None:
    client = TestClient(app)
    response = client.post(
        "/chat",
        json={
            "message": "hello",
            "context": {"pathname": "/donations"},
            "permissions": [],
            "toolSessionToken": "ast_123456789012345678901234",
            "toolsUrl": "http://api.test/api/v1/assistant/tools",
        },
    )

    assert response.status_code == 200
    assert response.json()["type"] == "answer"
