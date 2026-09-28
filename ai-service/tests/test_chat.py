from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date

import pytest
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
                name="ai_analysis.propose_run",
                description="Create an AI analysis proposal.",
                requiredPermission="reports:read",
                mutates=True,
                inputSchema={"type": "object"},
            ),
            AssistantToolDescriptor(
                name="navigation.propose",
                description="Return a permitted in-app navigation target.",
                mutates=False,
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
        permissions=["reports:read", "alerts:read", "inventory:read", "donors:read", "donations:read"],
        toolSessionToken="ast_123456789012345678901234",
        toolsUrl="http://api.test/api/v1/assistant/tools",
    )


def composed_response(*, source_ids: list[str], title: str = "Operational view") -> str:
    return json.dumps({
        "type": "composed_answer",
        "message": "The requested operational data is ready.",
        "composition": {
            "title": title,
            "summary": "This layout uses authorized live data.",
            "language": "en",
            "sections": [{
                "id": "overview",
                "layout": "grid",
                "blocks": [{
                    "id": "summary",
                    "type": "narrative",
                    "width": "full",
                    "content": "Operational source data is available.",
                    "sourceIds": source_ids,
                }],
            }],
            "suggestions": ["Show another comparison"],
        },
    })


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


def test_chat_limits_compositions_to_six_read_tools() -> None:
    calls = [
        {"sourceId": f"source_{index}", "name": "dashboard.summary", "arguments": {}}
        for index in range(7)
    ]
    result = run_chat(
        chat_request("build a broad report"),
        provider=FakeProvider([json.dumps({"tool_calls": calls})]),
        tool_client=FakeToolClient(),
    )

    assert result.type == "answer"
    assert result.unavailableCode == "ASSISTANT_TOOL_LIMIT_EXCEEDED"
    assert result.unavailableStage == "planning"


def test_composition_load_failure_does_not_request_layout_repair() -> None:
    calls = 0

    class LoadingProvider:
        @property
        def provider_name(self) -> str:
            return "ollama"

        @property
        def model_name(self) -> str:
            return "gpt-oss:20b"

        def complete(self, _messages: list[ChatMessage]) -> LlmCompletion:
            nonlocal calls
            calls += 1
            if calls == 1:
                return LlmCompletion(
                    content=(
                        '{"tool_calls":[{"sourceId":"source_summary","name":"dashboard.summary","arguments":{}}]}'
                    ),
                    provider=self.provider_name,
                    model=self.model_name,
                )
            raise AiServiceError(
                code="LLM_INVALID_RESPONSE",
                message=(
                    "Ollama returned an empty completion "
                    "(done_reason=load, message_keys=content,role, thinking_chars=0)."
                ),
                status_code=502,
            )

    result = run_chat(
        chat_request("show a summary"),
        provider=LoadingProvider(),
        tool_client=FakeToolClient(result={"kpis": {"availableUnits": 8}}),
    )

    assert calls == 2
    assert result.unavailableCode == "LLM_INVALID_RESPONSE"
    assert result.unavailableStage == "composition"
    assert result.message == "The AI model is still loading. Please retry the request in a moment."


def test_chat_repairs_an_unsafe_layout_once() -> None:
    unsafe = json.loads(composed_response(source_ids=["source_summary"]))
    unsafe["composition"]["sections"][0]["blocks"][0]["html"] = "<script>alert(1)</script>"
    provider = FakeProvider([
        '{"tool_calls":[{"sourceId":"source_summary","name":"dashboard.summary","arguments":{}}]}',
        json.dumps(unsafe),
        composed_response(source_ids=["source_summary"], title="Repaired layout"),
    ])
    result = run_chat(
        chat_request("show a summary"),
        provider=provider,
        tool_client=FakeToolClient(result={"kpis": {"availableUnits": 8}}),
    )

    assert result.type == "composed_answer"
    assert result.composition is not None
    assert result.composition.title == "Repaired layout"
    assert len(provider.messages) == 3
    assert [message.role for message in provider.messages[1]] == ["system", "user"]
    assert provider.messages[1][-1].content == "show a summary"
    assert [message.role for message in provider.messages[2]] == ["system", "user"]


def test_chat_repairs_a_layout_the_api_contract_would_reject() -> None:
    invalid = json.loads(composed_response(source_ids=["source_summary"]))
    invalid["composition"]["sections"][0]["id"] = "Overview"
    provider = FakeProvider([
        '{"tool_calls":[{"sourceId":"source_summary","name":"dashboard.summary","arguments":{}}]}',
        json.dumps(invalid),
        composed_response(source_ids=["source_summary"], title="Contract-safe layout"),
    ])
    result = run_chat(
        chat_request("show a summary"),
        provider=provider,
        tool_client=FakeToolClient(result={"kpis": {"availableUnits": 8}}),
    )

    assert result.type == "composed_answer"
    assert result.composition is not None
    assert result.composition.title == "Contract-safe layout"
    assert "sections.0.id" in provider.messages[2][0].content


def test_composed_answer_serializes_without_null_fields() -> None:
    provider = FakeProvider([
        '{"tool_calls":[{"sourceId":"source_summary","name":"dashboard.summary","arguments":{}}]}',
        composed_response(source_ids=["source_summary"]),
    ])
    result = run_chat(
        chat_request("show a summary"),
        provider=provider,
        tool_client=FakeToolClient(result={"kpis": {"availableUnits": 8}}),
    )

    dumped = result.model_dump(exclude_none=True)
    block = dumped["composition"]["sections"][0]["blocks"][0]
    assert "title" not in dumped["composition"]["sections"][0]
    assert block == {
        "id": "summary",
        "width": "full",
        "type": "narrative",
        "content": "Operational source data is available.",
        "sourceIds": ["source_summary"],
    }


def test_planning_retries_once_after_an_empty_completion() -> None:
    calls = 0

    class FlakyProvider:
        @property
        def provider_name(self) -> str:
            return "ollama"

        @property
        def model_name(self) -> str:
            return "gpt-oss:20b"

        def complete(self, _messages: list[ChatMessage]) -> LlmCompletion:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise AiServiceError(
                    code="LLM_INVALID_RESPONSE",
                    message="Ollama returned an empty completion (done_reason=stop, message_keys=content,role, thinking_chars=0).",
                    status_code=502,
                )
            return LlmCompletion(
                content='{"type":"answer","message":"Planning recovered."}',
                provider=self.provider_name,
                model=self.model_name,
            )

    result = run_chat(chat_request("summarize stock"), provider=FlakyProvider(), tool_client=FakeToolClient())

    assert calls == 2
    assert result.type == "answer"
    assert result.message == "Planning recovered."


def test_planning_does_not_retry_a_provider_timeout() -> None:
    calls = 0

    class SlowProvider:
        @property
        def provider_name(self) -> str:
            return "ollama"

        @property
        def model_name(self) -> str:
            return "gpt-oss:20b"

        def complete(self, _messages: list[ChatMessage]) -> LlmCompletion:
            nonlocal calls
            calls += 1
            raise AiServiceError(code="LLM_PROVIDER_ERROR", message="Ollama timed out after 60.0s.", status_code=504)

    result = run_chat(chat_request("summarize stock"), provider=SlowProvider(), tool_client=FakeToolClient())

    assert calls == 1
    assert result.unavailableCode == "LLM_PROVIDER_ERROR"


def test_plan_nested_inside_a_tool_call_is_unwrapped() -> None:
    nested = {
        "tool_call": {
            "name": "dashboard.summary",
            "arguments": {
                "tool_calls": [{"sourceId": "source_summary", "name": "dashboard.summary", "arguments": {"from": "2026-09-01"}}],
            },
        }
    }
    tool_client = FakeToolClient(result={"kpis": {"availableUnits": 8}})
    provider = FakeProvider([json.dumps(nested), composed_response(source_ids=["source_summary"])])

    result = run_chat(chat_request("show a summary"), provider=provider, tool_client=tool_client)

    assert result.type == "composed_answer"
    assert tool_client.calls == [("dashboard.summary", {"from": "2026-09-01"})]


def test_tool_call_wrapped_in_another_tool_call_is_unwrapped() -> None:
    wrapped = {
        "tool_call": {
            "name": "dashboard.summary",
            "arguments": {"name": "donations.search", "arguments": {"donorId": 12}},
        }
    }
    tool_client = FakeToolClient(result={"items": [{"id": 1}], "total": 1})
    provider = FakeProvider([json.dumps(wrapped), composed_response(source_ids=["source_1"])])

    result = run_chat(chat_request("donations for donor 12"), provider=provider, tool_client=tool_client)

    assert result.type == "composed_answer"
    assert tool_client.calls == [("donations.search", {"donorId": 12})]


def test_plan_source_ids_and_tool_prefixes_are_normalized() -> None:
    plan = {
        "tool_calls": [
            {"sourceId": "Inventory Summary", "name": "functions.dashboard.summary", "arguments": None},
            {"sourceId": "source_inventory_summary", "name": "dashboard.alerts", "arguments": {}},
        ]
    }
    tool_client = FakeToolClient(result={"kpis": {"availableUnits": 8}})
    provider = FakeProvider([json.dumps(plan), composed_response(source_ids=["source_inventory_summary"])])

    result = run_chat(chat_request("summary and alerts"), provider=provider, tool_client=tool_client)

    assert result.type == "composed_answer"
    assert tool_client.calls == [("dashboard.summary", {}), ("dashboard.alerts", {})]
    assert [source.sourceId for source in result.sources or []] == ["source_inventory_summary", "source_2"]


def test_namespaced_tool_names_resolve_to_known_tools() -> None:
    plan = {"tool_call": {"name": "tool.dashboard.summary", "arguments": {}}}
    tool_client = FakeToolClient(result={"kpis": {"availableUnits": 8}})
    provider = FakeProvider([json.dumps(plan), composed_response(source_ids=["source_1"])])

    result = run_chat(chat_request("summary"), provider=provider, tool_client=tool_client)

    assert result.type == "composed_answer"
    assert tool_client.calls == [("dashboard.summary", {})]


def test_fenced_or_prefixed_json_is_parsed() -> None:
    plan = {"tool_call": {"name": "dashboard.summary", "arguments": {}}}
    tool_client = FakeToolClient(result={"kpis": {"availableUnits": 8}})
    provider = FakeProvider([
        f"```json\n{json.dumps(plan)}\n```",
        f"Here is the layout:\n{composed_response(source_ids=["source_1"])}",
    ])

    result = run_chat(chat_request("summary"), provider=provider, tool_client=tool_client)

    assert result.type == "composed_answer"


def test_mutating_tool_inside_a_multi_call_plan_is_rejected_cleanly() -> None:
    plan = {
        "tool_calls": [
            {"sourceId": "source_summary", "name": "dashboard.summary", "arguments": {}},
            {"sourceId": "source_run", "name": "ai_analysis.propose_run", "arguments": {}},
        ]
    }
    result = run_chat(chat_request("summarize and run"), provider=FakeProvider([json.dumps(plan)]), tool_client=FakeToolClient())

    assert result.unavailableCode == "ASSISTANT_TOOL_PLAN_INVALID"
    assert "confirmation action" in result.message


def test_planning_prompt_includes_today() -> None:
    provider = FakeProvider(['{"type":"answer","message":"ok"}'])

    run_chat(chat_request("summarize stock"), provider=provider, tool_client=FakeToolClient())

    assert f"Today's date: {date.today().isoformat()}" in provider.messages[0][0].content


def test_missing_table_title_defaults_from_block_id() -> None:
    layout = json.loads(composed_response(source_ids=["source_inventory"]))
    layout["composition"]["sections"][0]["blocks"].append({
        "id": "stock_by_group",
        "type": "table",
        "width": "full",
        "sourceId": "source_inventory",
        "path": "items",
        "columns": [{"key": "bloodGroup", "label": "Blood group"}],
        "limit": 10,
    })
    provider = FakeProvider([
        '{"tool_calls":[{"sourceId":"source_inventory","name":"dashboard.summary","arguments":{}}]}',
        json.dumps(layout),
    ])

    result = run_chat(
        chat_request("stock by group"),
        provider=provider,
        tool_client=FakeToolClient(result={"items": [{"bloodGroup": "O+"}]}),
    )

    assert result.type == "composed_answer"
    assert result.composition is not None
    table = result.composition.sections[0].blocks[1]
    assert table.title == "Stock by group"
    assert len(provider.messages) == 2


def _metrics_layout(path: str) -> dict[str, object]:
    layout = json.loads(composed_response(source_ids=["source_summary"]))
    layout["composition"]["sections"][0]["blocks"].append({
        "id": "kpis",
        "type": "metrics",
        "width": "full",
        "items": [{"label": "Available", "binding": {"sourceId": "source_summary", "path": path}}],
    })
    return layout


def test_layout_with_unknown_data_path_is_repaired_with_the_exact_path() -> None:
    provider = FakeProvider([
        '{"tool_calls":[{"sourceId":"source_summary","name":"dashboard.summary","arguments":{}}]}',
        json.dumps(_metrics_layout("totals.availableUnits")),
        json.dumps(_metrics_layout("kpis.availableUnits")),
    ])

    result = run_chat(
        chat_request("show a summary"),
        provider=provider,
        tool_client=FakeToolClient(result={"kpis": {"availableUnits": 8}}),
    )

    assert result.type == "composed_answer"
    repair_prompt = provider.messages[2][0].content
    assert 'path "totals.availableUnits" not in source_summary' in repair_prompt
    assert "keys kpis" in repair_prompt


def test_layout_blocks_still_bound_to_missing_data_are_dropped_after_repair() -> None:
    provider = FakeProvider([
        '{"tool_calls":[{"sourceId":"source_summary","name":"dashboard.summary","arguments":{}}]}',
        json.dumps(_metrics_layout("totals.availableUnits")),
        json.dumps(_metrics_layout("totals.stillWrong")),
    ])

    result = run_chat(
        chat_request("show a summary"),
        provider=provider,
        tool_client=FakeToolClient(result={"kpis": {"availableUnits": 8}}),
    )

    assert result.type == "composed_answer"
    assert result.composition is not None
    assert [block.type for block in result.composition.sections[0].blocks] == ["narrative"]


_DONATION_RECORDS = {
    "items": [{
        "id": 1,
        "donationDate": "2026-09-20",
        "donor": {"firstName": "Amina", "lastName": "Juma", "name": "Amina Juma"},
        "bloodGroup": {"id": 7, "name": "O+"},
    }],
    "total": 1,
}


def _donor_table_layout(columns: list[str]) -> dict[str, object]:
    return {
        "type": "composed_answer",
        "message": "Recent donations.",
        "composition": {
            "title": "Recent donations",
            "summary": "Donations with donor names.",
            "language": "en",
            "sections": [{
                "id": "donations",
                "layout": "grid",
                "blocks": [{
                    "id": "donation_table",
                    "type": "table",
                    "width": "full",
                    "title": "Donations",
                    "sourceId": "source_1",
                    "path": "items",
                    "columns": [{"key": key, "label": key} for key in columns],
                    "limit": 10,
                }],
            }],
        },
    }


def test_missing_table_key_is_rewritten_to_its_single_nested_path() -> None:
    provider = FakeProvider([
        '{"tool_call":{"name":"donations.search","arguments":{}}}',
        json.dumps(_donor_table_layout(["firstName", "lastName", "donationDate"])),
    ])

    result = run_chat(chat_request("recent donations with donor names"), provider=provider, tool_client=FakeToolClient(result=_DONATION_RECORDS))

    assert result.type == "composed_answer"
    assert len(provider.messages) == 2
    table = result.composition.sections[0].blocks[0] if result.composition else None
    assert [column.key for column in getattr(table, "columns", [])] == ["donor.firstName", "donor.lastName", "donationDate"]


def test_ambiguous_nested_key_is_not_rewritten_and_repair_hint_lists_nested_keys() -> None:
    provider = FakeProvider([
        '{"tool_call":{"name":"donations.search","arguments":{}}}',
        json.dumps(_donor_table_layout(["name"])),
        json.dumps(_donor_table_layout(["donor.name"])),
    ])

    result = run_chat(chat_request("recent donations with donor names"), provider=provider, tool_client=FakeToolClient(result=_DONATION_RECORDS))

    assert result.type == "composed_answer"
    repair_prompt = provider.messages[2][0].content
    assert 'key "name" not in source_1.items' in repair_prompt
    assert "donor.firstName" in repair_prompt


def test_chat_returns_action_proposal_from_tool() -> None:
    proposal = {
        "id": "act_123456789abc",
        "action": "ai_analysis.run",
        "title": "Run AI analysis",
        "description": "Run a report-only analysis.",
        "requiredPermission": "reports:read",
        "payload": {"horizonDays": 7, "notificationMode": "REPORT_ONLY"},
        "effect": "Creates an AI analysis run after confirmation.",
    }
    provider = FakeProvider(
        ['{"tool_call":{"name":"ai_analysis.propose_run","arguments":{"horizonDays":7,"notificationMode":"REPORT_ONLY"}}}']
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


def test_planning_failure_logs_provider_detail(caplog: pytest.LogCaptureFixture) -> None:
    class FailingProvider:
        @property
        def provider_name(self) -> str:
            return "ollama"

        @property
        def model_name(self) -> str:
            return "gpt-oss:20b"

        def complete(self, _messages: list[ChatMessage]) -> LlmCompletion:
            raise AiServiceError(
                code="LLM_INVALID_RESPONSE",
                message=(
                    "Ollama returned an empty completion "
                    "(done_reason=length, message_keys=content,thinking, thinking_chars=1200)."
                ),
                status_code=502,
            )

    with caplog.at_level(logging.WARNING):
        result = run_chat(
            chat_request("how much O+ is available?"),
            provider=FailingProvider(),
            tool_client=FakeToolClient(),
        )

    assert result.unavailableCode == "LLM_INVALID_RESPONSE"
    assert result.unavailableStage == "planning"
    assert "done_reason=length" in caplog.text
    assert "thinking_chars=1200" in caplog.text


def test_chat_invalid_model_json_asks_for_specific_detail_without_page_fallback() -> None:
    provider = FakeProvider(["not-json", "still-not-json"])
    result = run_chat(
        chat_request("can you help here?"),
        provider=provider,
        tool_client=FakeToolClient(),
    )

    assert result.type == "answer"
    assert result.unavailableCode == "CHAT_INVALID_LLM_RESPONSE"
    assert result.unavailableStage == "planning"
    assert "I can help with" not in result.message
    assert "/donations" not in result.message


def test_overall_system_report_uses_llm_selected_cross_domain_tools() -> None:
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

    provider = FakeProvider([
        '{"tool_calls":[{"sourceId":"source_summary","name":"dashboard.summary","arguments":{}},{"sourceId":"source_alerts","name":"dashboard.alerts","arguments":{"limit":5}}]}',
        composed_response(source_ids=["source_summary", "source_alerts"], title="Overall NBTS report"),
    ])
    result = run_chat(
        chat_request("can I get the overall report on the system"),
        provider=provider,
        tool_client=tool_client,
    )

    assert result.type == "composed_answer"
    assert result.composition is not None
    assert result.composition.title == "Overall NBTS report"
    assert result.sources is not None
    assert [source.sourceId for source in result.sources] == ["source_summary", "source_alerts"]
    assert tool_client.calls == [
        ("dashboard.summary", {}),
        ("dashboard.alerts", {"limit": 5}),
    ]


def test_composition_keeps_successful_sources_when_one_tool_fails() -> None:
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

    provider = FakeProvider([
        '{"tool_calls":[{"sourceId":"source_summary","name":"dashboard.summary","arguments":{}},{"sourceId":"source_alerts","name":"dashboard.alerts","arguments":{"limit":5}}]}',
        composed_response(source_ids=["source_summary"]),
    ])
    result = run_chat(
        chat_request("overall report on the system"),
        provider=provider,
        tool_client=tool_client,
    )

    assert result.type == "composed_answer"
    assert result.sources is not None
    assert len(result.sources) == 2


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
    assert result.unavailableCode == "API_TOOL_UNAVAILABLE"
    assert result.unavailableStage == "tools"
    assert "API_INTERNAL_BASE_URL" in result.message
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
    assert result.unavailableCode == "API_TOOL_UNAVAILABLE"
    assert result.unavailableStage == "data"
    assert "database availability" in result.message


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


def test_invalid_composition_and_failed_repair_returns_unavailable() -> None:
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
    assert result.unavailableCode == "ASSISTANT_LAYOUT_INVALID"
    assert result.unavailableStage == "composition"


def test_chat_without_llm_still_uses_tools_for_known_actions() -> None:
    proposal = {
        "id": "act_123456789abc",
        "action": "ai_analysis.run",
        "title": "Run AI analysis",
        "description": "Run a report-only analysis.",
        "requiredPermission": "reports:read",
        "payload": {"horizonDays": 14, "notificationMode": "REPORT_ONLY"},
        "effect": "Creates an AI analysis run after confirmation.",
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
        ("ai_analysis.propose_run", {"horizonDays": 14, "notificationMode": "REPORT_ONLY"})
    ]


def test_chat_without_llm_uses_canonical_facilities_route() -> None:
    tool_client = FakeToolClient(
        result={
            "type": "navigation",
            "path": "/admin/facilities",
            "message": "Opening facilities.",
            "requiredPermission": "facilities:read",
        }
    )

    result = run_chat(
        chat_request("open facilities"),
        tool_client=tool_client,
    )

    assert result.type == "navigation"
    assert result.path == "/admin/facilities"
    assert tool_client.calls == [
        ("navigation.propose", {"path": "/admin/facilities", "label": "facilities"})
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
