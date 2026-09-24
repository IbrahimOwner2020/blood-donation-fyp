"""LLM-backed chat orchestration with API-owned tools."""

from __future__ import annotations

import json
import re
from typing import Any, Protocol

from app.config import Settings, get_settings
from app.errors import AiServiceError
from app.llm.providers.base import ChatMessage, LlmProvider
from app.llm.providers.factory import get_llm_provider
from app.schemas import (
    AssistantActionProposal,
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantToolDescriptor,
)
from app.chat.tools import ApiToolClient


class ToolClient(Protocol):
    def list_tools(self) -> list[AssistantToolDescriptor]: ...
    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any: ...


def clarification_response() -> AssistantChatResponse:
    return AssistantChatResponse(
        type="answer",
        message="I need a more specific question to access the right NBTS data. Ask for a summary, a record id, a filter, or an action.",
    )


def data_unavailable_response() -> AssistantChatResponse:
    return AssistantChatResponse(
        type="answer",
        message="I cannot access live NBTS data for that request right now. Please try again once the assistant tools are available.",
    )


def _tool_summary(tools: list[AssistantToolDescriptor]) -> str:
    return "\n".join(
        f"- {tool.name}: {tool.description} "
        f"(permission: {tool.requiredPermission or 'authenticated'}, mutates: {tool.mutates})"
        for tool in tools
    )


def _system_prompt(
    request: AssistantChatRequest,
    tools: list[AssistantToolDescriptor],
) -> str:
    path = request.context.pathname if request.context else None
    filters = request.context.filters if request.context else {}
    return (
        "You are the NBTS operational assistant. Answer naturally and specifically.\n"
        "Use the listed API tools when live NBTS data, navigation, or action proposals are needed.\n"
        "Never claim an action was executed unless a tool result says so.\n"
        "Mutations and sends must be returned as action proposals only; the web UI confirms them.\n"
        "Return JSON only. Allowed final shapes:\n"
        '{"type":"answer","message":"..."}\n'
        '{"type":"navigation","message":"...","path":"/...","requiredPermission":"..."}\n'
        '{"type":"permission_denied","message":"...","requiredPermission":"..."}\n'
        '{"type":"action_proposal","message":"...","proposal":{...}}\n'
        "To request one tool call, return:\n"
        '{"tool_call":{"name":"tool.name","arguments":{}}}\n'
        f"Current path: {path or '/'}\n"
        f"Current filters: {json.dumps(filters, default=str)}\n"
        f"User permissions: {', '.join(request.permissions) or 'none'}\n"
        f"Available tools:\n{_tool_summary(tools)}"
    )


def _parse_json_object(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise AiServiceError(
            code="CHAT_INVALID_LLM_RESPONSE",
            message="The assistant model returned invalid JSON.",
            status_code=502,
        ) from exc
    if not isinstance(parsed, dict):
        raise AiServiceError(
            code="CHAT_INVALID_LLM_RESPONSE",
            message="The assistant model returned a non-object response.",
            status_code=502,
        )
    return parsed


def _blood_group(message: str) -> str | None:
    match = re.search(r"(^|[^A-Za-z0-9])((?:AB|A|B|O)[+-])(?=$|[^A-Za-z0-9])", message.upper())
    return match.group(2) if match else None


def _horizon_days(message: str) -> int:
    match = re.search(r"\b(7|14|30)\s*(day|days)?\b", message, flags=re.IGNORECASE)
    return int(match.group(1)) if match else 7


def _is_system_report_request(message: str) -> bool:
    text = message.lower()
    return bool(
        re.search(r"\b(overall|general|system|operations?|operational|status|report|summary|overview)\b", text)
        and re.search(r"\b(report|summary|overview|status|how are we|what is happening)\b", text)
    )


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _items(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in ("items", "data", "results", "alerts", "predictions", "donations", "donors", "inventory"):
            items = value.get(key)
            if isinstance(items, list):
                return items
    return []


def _total(value: dict[str, Any], items: list[Any]) -> int:
    for key in ("total", "totalItems", "count"):
        candidate = value.get(key)
        if isinstance(candidate, int):
            return candidate
    return len(items)


def _display(value: Any, *keys: str, default: str = "unknown") -> str:
    if not isinstance(value, dict):
        return default
    for key in keys:
        candidate = value.get(key)
        if candidate is not None and candidate != "":
            if isinstance(candidate, dict):
                for nested_key in ("code", "name", "fullName", "label", "id"):
                    nested = candidate.get(nested_key)
                    if nested is not None and nested != "":
                        return str(nested)
                return default
            if isinstance(candidate, list):
                return ", ".join(str(item) for item in candidate[:3]) if candidate else default
            if isinstance(candidate, bool):
                return "yes" if candidate else "no"
            return str(candidate)
    return default


def _label(key: str) -> str:
    spaced = re.sub(r"(?<!^)([A-Z])", r" \1", key).replace("_", " ")
    return spaced.lower()


def _blood_group_from_record(record: Any) -> str:
    if not isinstance(record, dict):
        return "unknown group"
    blood_group = record.get("bloodGroup")
    if isinstance(blood_group, dict):
        return _display(blood_group, "name", "code", "group")
    return _display(record, "bloodGroup", "blood_group", default="unknown group")


def _format_records(label: str, result: Any, fields: tuple[str, ...]) -> str:
    data = _as_dict(result)
    items = _items(result)
    total = _total(data, items)
    if total == 0:
        return f"No {label} matched that request."

    rows: list[str] = []
    for item in items[:5]:
        if not isinstance(item, dict):
            continue
        identity = _display(item, "id", default="")
        details = [f"{_label(field)} {_display(item, field)}" for field in fields if _display(item, field) != "unknown"]
        if not details:
            details.append(_blood_group_from_record(item))
        prefix = f"#{identity}: " if identity else ""
        rows.append(f"{prefix}{', '.join(details)}")

    if not rows:
        return f"I found {total} {label}, but the records did not include displayable fields."

    suffix = f" Showing {len(rows)}." if total > len(rows) else ""
    return f"I found {total} {label}.{suffix}\n" + "\n".join(f"- {row}" for row in rows)


def _format_dashboard_summary(result: Any) -> str:
    data = _as_dict(result)
    kpis = _as_dict(data.get("kpis"))
    if not kpis:
        return "I could not find dashboard summary values in the live response."
    return (
        "Dashboard snapshot: "
        f"{_display(kpis, 'availableUnits')} available units, "
        f"{_display(kpis, 'lowStockGroupCount')} low-stock groups, "
        f"{_display(kpis, 'activeAlerts')} active alerts, and "
        f"{_display(kpis, 'donationsThisPeriod')} donations in the selected period."
    )


def _format_dashboard_trends(result: Any) -> str:
    data = _as_dict(result)
    parts: list[str] = []
    for key, label in (("inventory", "inventory"), ("donations", "donations"), ("demand", "demand")):
        points = _items(data.get(key))
        if points:
            parts.append(f"{label}: {len(points)} trend points")
    return "Trend data is available: " + ", ".join(parts) + "." if parts else "No trend points matched that request."


def _format_dashboard_predictions(result: Any) -> str:
    return _format_records(
        "prediction records",
        result,
        ("bloodGroup", "horizonDays", "predictedUnits", "totalPredictedUnits", "modelName", "createdAt"),
    )


def _format_dashboard_alerts(result: Any) -> str:
    return _format_records("alert records", result, ("bloodGroup", "severity", "status", "gapUnits"))


def _format_proposal(result: dict[str, Any]) -> AssistantChatResponse:
    proposal = AssistantActionProposal.model_validate(result["proposal"])
    return AssistantChatResponse(
        type="action_proposal",
        message=f"{proposal.title} is ready for confirmation. {proposal.effect}",
        proposal=proposal,
    )


def _format_tool_result(name: str, result: Any) -> str:
    if name == "dashboard.summary":
        return _format_dashboard_summary(result)
    if name == "dashboard.trends":
        return _format_dashboard_trends(result)
    if name == "dashboard.predictions":
        return _format_dashboard_predictions(result)
    if name == "dashboard.alerts" or name == "alerts.search":
        return _format_dashboard_alerts(result)
    if name == "donors.search":
        return _format_records("donor records", result, ("donorNumber", "firstName", "lastName", "bloodGroup", "eligibilityStatus", "active"))
    if name == "donors.get":
        return _format_records(
            "donor record",
            {"items": [result], "total": 1} if result else {"items": []},
            ("donorNumber", "firstName", "lastName", "bloodGroup", "eligibilityStatus", "active"),
        )
    if name == "donations.search":
        return _format_records("donation records", result, ("donorId", "bloodGroup", "unitsCollected", "donationDate", "status"))
    if name == "donations.get":
        return _format_records("donation record", {"items": [result], "total": 1} if result else {"items": []}, ("donorId", "bloodGroup", "unitsCollected", "donationDate", "status"))
    if name == "inventory.search":
        return _format_records("inventory units", result, ("bloodGroup", "status", "expiryDate", "facilityId"))
    if name == "inventory.get":
        return _format_records("inventory unit", {"items": [result], "total": 1} if result else {"items": []}, ("bloodGroup", "status", "expiryDate", "facilityId"))
    if name == "alerts.get":
        return _format_records("alert record", {"items": [result], "total": 1} if result else {"items": []}, ("bloodGroup", "severity", "status", "gapUnits"))
    return "I found live NBTS data for that request, but there is no chat formatter for that tool yet."


def _available_tool_names(tools: list[AssistantToolDescriptor]) -> set[str]:
    return {tool.name for tool in tools}


def _system_report_response(
    client: ToolClient,
    tools: list[AssistantToolDescriptor],
) -> AssistantChatResponse:
    available = _available_tool_names(tools)
    sections: list[str] = []
    calls = (
        ("dashboard.summary", {}),
        ("dashboard.alerts", {"limit": 5}),
        ("dashboard.predictions", {"limit": 5}),
        ("donations.search", {"limit": 5}),
        ("donors.search", {"limit": 5}),
    )

    for tool_name, args in calls:
        if tool_name not in available:
            continue
        try:
            result = client.call_tool(tool_name, args)
        except AiServiceError as exc:
            if exc.code == "FORBIDDEN":
                continue
            sections.append(f"{tool_name}: this section is unavailable right now.")
            continue
        formatted = _format_tool_result(tool_name, result)
        if formatted:
            sections.append(formatted)

    if not sections:
        return AssistantChatResponse(
            type="permission_denied",
            message="Your account cannot access the operational data needed for an overall NBTS report.",
            requiredPermission="reports:read",
        )

    return AssistantChatResponse(
        type="answer",
        message="Overall NBTS operational report:\n\n" + "\n\n".join(sections),
    )


def _heuristic_tool_response(
    request: AssistantChatRequest,
    client: ToolClient,
    tools: list[AssistantToolDescriptor],
) -> AssistantChatResponse | None:
    message = request.message.lower()
    available = _available_tool_names(tools)

    if _is_system_report_request(request.message):
        return _system_report_response(client, tools)

    if any(word in message for word in ["open", "show", "go to", "navigate"]):
        targets = {
            "dashboard": "/dashboard",
            "facility": "/admin/facilities",
            "facilities": "/admin/facilities",
            "alert": "/inventory",
            "donor": "/donors",
            "donation": "/donations",
            "inventory": "/inventory",
            "request": "/blood-requests",
            "forecast": "/reports",
            "prediction": "/reports",
            "notification": "/notifications",
            "report": "/reports",
        }
        for key, path in targets.items():
            if key in message and "navigation.propose" in available:
                return _response_from_tool_result(
                    client.call_tool(
                        "navigation.propose",
                        {"path": path, "label": key},
                    ),
                    "navigation.propose",
                )

    if any(word in message for word in ["forecast", "prediction"]) and any(
        word in message for word in ["run", "create", "generate"]
    ):
        blood_group = _blood_group(request.message)
        if not blood_group:
            return AssistantChatResponse(
                type="answer",
                message="Which blood group should I run the forecast for? Include a value like O+ or AB-.",
            )
        if "predictions.propose_run" in available:
            return _response_from_tool_result(
                client.call_tool(
                    "predictions.propose_run",
                    {"bloodGroup": blood_group, "horizonDays": _horizon_days(request.message)},
                ),
                "predictions.propose_run",
            )

    if "donor" in message and "donors.search" in available:
        return _response_from_tool_result(
            client.call_tool("donors.search", {"limit": 10}),
            "donors.search",
        )

    if "donation" in message and "donations.search" in available:
        return _response_from_tool_result(
            client.call_tool("donations.search", {"limit": 10}),
            "donations.search",
        )

    if ("inventory" in message or "unit" in message or "stock" in message) and "inventory.search" in available:
        return _response_from_tool_result(
            client.call_tool("inventory.search", {"limit": 10}),
            "inventory.search",
        )

    if ("alert" in message or "shortage" in message) and "alerts.search" in available:
        return _response_from_tool_result(
            client.call_tool("alerts.search", {"limit": 10}),
            "alerts.search",
        )

    if ("dashboard" in message or "summary" in message or "overview" in message) and "dashboard.summary" in available:
        return _response_from_tool_result(
            client.call_tool("dashboard.summary", {}),
            "dashboard.summary",
        )

    return None


def _response_from_tool_result(result: Any, tool_name: str = "unknown") -> AssistantChatResponse:
    if isinstance(result, dict):
        if isinstance(result.get("proposal"), dict):
            return _format_proposal(result)
        if result.get("type") == "navigation":
            return AssistantChatResponse.model_validate(result)
    return AssistantChatResponse(
        type="answer",
        message=_format_tool_result(tool_name, result),
    )


def run_chat(
    request: AssistantChatRequest,
    *,
    settings: Settings | None = None,
    provider: LlmProvider | None = None,
    tool_client: ToolClient | None = None,
) -> AssistantChatResponse:
    cfg = settings or get_settings()
    client = tool_client or ApiToolClient(
        tools_url=request.toolsUrl,
        tool_session_token=request.toolSessionToken,
        timeout_seconds=cfg.llm_timeout_seconds,
    )
    try:
        tools = client.list_tools()
    except AiServiceError:
        return data_unavailable_response()

    if _is_system_report_request(request.message):
        try:
            return _system_report_response(client, tools)
        except AiServiceError:
            return data_unavailable_response()

    try:
        llm = provider or get_llm_provider(cfg)
    except AiServiceError:
        heuristic = _heuristic_tool_response(request, client, tools) if tools else None
        return heuristic or clarification_response()

    try:
        history = [
            ChatMessage(role=item.get("role", "user"), content=item.get("content", "")[:2000])
            for item in request.history[-10:]
            if item.get("role") in {"user", "assistant"} and item.get("content")
        ]
        first = llm.complete(
            [ChatMessage(role="system", content=_system_prompt(request, tools)), *history, ChatMessage(role="user", content=request.message)]
        )
        parsed = _parse_json_object(first.content)
    except AiServiceError:
        return clarification_response()

    tool_call = parsed.get("tool_call")
    if isinstance(tool_call, dict):
        name = tool_call.get("name")
        arguments = tool_call.get("arguments", {})
        if not isinstance(name, str) or not isinstance(arguments, dict):
            return clarification_response()
        if name not in {tool.name for tool in tools}:
            return data_unavailable_response()
        try:
            tool_result = client.call_tool(name, arguments)
        except AiServiceError as exc:
            if exc.code == "FORBIDDEN":
                return AssistantChatResponse(
                    type="permission_denied",
                    message=exc.message,
                    requiredPermission="unknown",
                )
            return data_unavailable_response()

        if isinstance(tool_result, dict) and (
            "proposal" in tool_result or tool_result.get("type") == "navigation"
        ):
            return _response_from_tool_result(tool_result, name)

        try:
            second = llm.complete(
                [
                    ChatMessage(role="system", content=_system_prompt(request, tools)),
                    ChatMessage(role="user", content=request.message),
                    ChatMessage(
                        role="assistant",
                        content=json.dumps({"tool_call": tool_call}, default=str),
                    ),
                    ChatMessage(
                        role="user",
                        content=(
                            "Tool result JSON. Produce one final allowed JSON response: "
                            f"{json.dumps(tool_result, default=str)[:8000]}"
                        ),
                    ),
                ]
            )
            return AssistantChatResponse.model_validate(_parse_json_object(second.content))
        except (AiServiceError, ValueError):
            return AssistantChatResponse(type="answer", message=_format_tool_result(name, tool_result))

    try:
        return AssistantChatResponse.model_validate(parsed)
    except ValueError:
        return clarification_response()
