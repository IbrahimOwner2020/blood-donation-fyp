"""LLM-backed chat orchestration with API-owned tools."""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Any, Literal, Protocol

from pydantic import ValidationError

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


logger = logging.getLogger(__name__)


def clarification_response() -> AssistantChatResponse:
    return AssistantChatResponse(
        type="answer",
        message="I need a more specific question to access the right NBTS data. Ask for a summary, a record id, a filter, or an action.",
    )


def data_unavailable_response(
    *,
    code: str,
    stage: Literal["tools", "provider", "planning", "data", "composition"],
    message: str,
    reason: str | None = None,
) -> AssistantChatResponse:
    logger.warning(
        "assistant_unavailable code=%s stage=%s reason=%s",
        code,
        stage,
        reason or "not_provided",
    )
    return AssistantChatResponse(
        type="answer",
        message=message,
        unavailableCode=code,
        unavailableStage=stage,
        retryable=True,
    )


def _tool_summary(tools: list[AssistantToolDescriptor]) -> str:
    return "\n".join(
        f"- {tool.name}: {tool.description} "
        f"(permission: {tool.requiredPermission or 'authenticated'}, mutates: {tool.mutates}, "
        f"input: {json.dumps(tool.inputSchema, default=str)})"
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
        "Answer in Swahili when the user's current message is Swahili; otherwise answer in English.\n"
        "Keep canonical record codes and identifiers unchanged when translating explanations.\n"
        "Use the listed API tools when live NBTS data, navigation, or action proposals are needed.\n"
        "Never claim an action was executed unless a tool result says so.\n"
        "Mutations and sends must be returned as action proposals only; the web UI confirms them.\n"
        "For a data question, first request up to six read tools in one JSON object.\n"
        "Use a unique sourceId for each tool call and never include mutating tools in a tool_calls array.\n"
        'Format: {"tool_calls":[{"sourceId":"source_inventory","name":"tool.name","arguments":{}}]}\n'
        "For a mutation or navigation, request exactly one tool_call so the API can preserve its confirmation flow.\n"
        "Return JSON only. Allowed non-data final shapes:\n"
        '{"type":"answer","message":"..."}\n'
        '{"type":"navigation","message":"...","path":"/...","requiredPermission":"..."}\n'
        '{"type":"permission_denied","message":"...","requiredPermission":"..."}\n'
        '{"type":"action_proposal","message":"...","proposal":{...}}\n'
        "To request one tool call, return:\n"
        '{"tool_call":{"name":"tool.name","arguments":{}}}\n'
        "Tool arguments contain only that tool's input fields; never nest tool_call or tool_calls inside arguments.\n"
        f"Today's date: {date.today().isoformat()}. Resolve relative periods (today, this month, last 30 days) from this date.\n"
        f"Current path: {path or '/'}\n"
        f"Current filters: {json.dumps(filters, default=str)}\n"
        f"User permissions: {', '.join(request.permissions) or 'none'}\n"
        f"Available tools:\n{_tool_summary(tools)}"
    )


def _composition_prompt(
    request: AssistantChatRequest,
    sources: list[dict[str, Any]],
    *,
    repair: str | None = None,
) -> str:
    repair_text = f"\nThe previous composition was invalid: {repair}. Return a corrected object.\n" if repair else ""
    return (
        "Compose the final response from the supplied API source results. Return JSON only with type composed_answer.\n"
        "Required shape: {\"type\":\"composed_answer\",\"message\":\"short status\","
        "\"sources\":[{\"sourceId\":\"source_x\",\"tool\":\"tool.name\",\"arguments\":{}}],"
        "\"composition\":{\"title\":\"...\",\"summary\":\"...\",\"language\":\"en|sw\","
        "\"sections\":[{\"id\":\"overview\",\"layout\":\"stack|grid|columns\",\"blocks\":[...]}],"
        "\"suggestions\":[]}}.\n"
        "Safe block types are narrative, metrics, comparison, table, chart, ranked_list, status_summary, timeline, notice, recommendation.\n"
        "Every block needs type, id (lowercase letters, digits, _ or -, starting with a letter) and width (full, half, third, or two-thirds).\n"
        "Section ids follow the same lowercase id rule.\n"
        "Required fields per block type:\n"
        "- narrative: content, sourceIds\n"
        "- metrics: items:[{label,binding:{sourceId,path,operation,field?}}]. Operations: value,count,sum,average,minimum,maximum.\n"
        "- comparison: title, label, current binding, previous binding, mode (difference or percent_change)\n"
        "- table: title, sourceId, path, columns:[{key,label}], limit, optional sort:{key,direction}\n"
        "- chart: title, sourceId, path, chartType (line,bar,stacked_bar,area,pie,donut), xKey, series:[{key,label}]\n"
        "- ranked_list: title, sourceId, path, labelKey, valueKey, limit, direction\n"
        "- status_summary: title, sourceId, path, labelKey, valueKey\n"
        "- timeline: title, sourceId, path, dateKey, titleKey, detailKey, limit\n"
        "- notice and recommendation: tone (info,warning,error,success), message, sourceIds\n"
        "Do not copy operational numeric values into the layout. Bind all metrics, table cells, chart points, comparisons and list values to sources.\n"
        "Do not output HTML, CSS, scripts, URLs, phone numbers, email addresses, passwords, tokens, or contact fields.\n"
        "Use only paths and field names visible in the source samples. Keep sourceId/tool/arguments identical to the executed query plan.\n"
        "For fields inside nested objects use dot paths, for example donor.firstName or bloodGroup.name.\n"
        f"User request: {request.message}\n"
        f"Sources: {json.dumps(sources, default=str, ensure_ascii=False)}"
        f"{repair_text}"
    )


def _composition_messages(
    request: AssistantChatRequest,
    sources: list[dict[str, Any]],
    *,
    repair: str | None = None,
) -> list[ChatMessage]:
    # Ollama returns done_reason=load with empty content when the chat has no user turn.
    user_message = request.message.strip() or "Compose the layout from the supplied sources."
    return [
        ChatMessage(role="system", content=_composition_prompt(request, sources, repair=repair)),
        ChatMessage(role="user", content=user_message),
    ]


def _compact_result(value: Any, *, depth: int = 0) -> Any:
    if depth >= 5:
        return "[nested data omitted]"
    if isinstance(value, list):
        return [_compact_result(item, depth=depth + 1) for item in value[:40]]
    if isinstance(value, dict):
        return {
            key: _compact_result(item, depth=depth + 1)
            for key, item in list(value.items())[:60]
            if not re.search(r"phone|email|password|secret|token|hash|contact", key, flags=re.IGNORECASE)
        }
    return value


def _parse_json_object(content: str) -> dict[str, Any]:
    text = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", content or "")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        start = text.find("{")
        try:
            if start < 0:
                raise exc
            parsed, _ = json.JSONDecoder().raw_decode(text, start)
        except json.JSONDecodeError:
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


_RETRYABLE_PLANNING_CODES = {"LLM_INVALID_RESPONSE", "CHAT_INVALID_LLM_RESPONSE", "LLM_PROVIDER_ERROR"}


def _is_retryable_planning_error(error: AiServiceError) -> bool:
    if error.code not in _RETRYABLE_PLANNING_CODES:
        return False
    # A provider timeout already spent the full budget; retrying would exceed the API timeout.
    return not (error.code == "LLM_PROVIDER_ERROR" and error.status_code == 504)


def _unwrap_nested_plan(parsed: dict[str, Any]) -> dict[str, Any]:
    """Lift a plan the model wrapped inside a single tool call's arguments."""
    single = parsed.get("tool_call")
    arguments = single.get("arguments") if isinstance(single, dict) else None
    if not isinstance(arguments, dict):
        return parsed
    nested_calls = arguments.get("tool_calls")
    if isinstance(nested_calls, list) and nested_calls:
        return {"tool_calls": nested_calls}
    nested_call = arguments.get("tool_call")
    if isinstance(nested_call, dict):
        return {"tool_call": nested_call}
    inner_name = arguments.get("name")
    inner_arguments = arguments.get("arguments")
    if isinstance(inner_name, str) and inner_name.strip() and isinstance(inner_arguments, dict):
        return {"tool_call": {"name": inner_name.strip(), "arguments": inner_arguments}}
    return parsed


def _normalize_tool_name(raw: Any, known: set[str] | None = None) -> str:
    name = raw.strip() if isinstance(raw, str) else ""
    # gpt-oss may prefix tool names with a namespace such as "functions." or "tool.".
    name = name.removeprefix("functions.")
    if not known or name in known:
        return name
    parts = name.split(".")
    for start in range(1, len(parts)):
        candidate = ".".join(parts[start:])
        if candidate in known:
            return candidate
    return name


def _normalize_source_id(raw: Any, index: int, seen: set[str]) -> str:
    candidate = re.sub(r"[^a-z0-9_]+", "_", raw.strip().lower()).strip("_") if isinstance(raw, str) else ""
    if candidate and not candidate.startswith("source_"):
        candidate = f"source_{candidate}"
    if not candidate or len(candidate) > 64 or candidate in seen:
        candidate = f"source_{index + 1}"
    suffix = index + 1
    while candidate in seen:
        suffix += 1
        candidate = f"source_{suffix}"
    return candidate


def _plan_request(
    llm: LlmProvider,
    messages: list[ChatMessage],
) -> dict[str, Any]:
    try:
        return _unwrap_nested_plan(_parse_json_object(llm.complete(messages).content))
    except AiServiceError as first_error:
        if not _is_retryable_planning_error(first_error):
            raise
        logger.warning(
            "assistant_planning_retry code=%s reason=%s",
            first_error.code,
            first_error.message[:300],
        )
        return _unwrap_nested_plan(_parse_json_object(llm.complete(messages).content))


def _is_model_still_loading(error: Exception) -> bool:
    return (
        isinstance(error, AiServiceError)
        and error.code == "LLM_INVALID_RESPONSE"
        and "done_reason=load" in error.message
    )


def _safe_validation_summary(error: Exception) -> str:
    if isinstance(error, AiServiceError):
        return f"{error.code}: {error.message[:240]}"
    if isinstance(error, ValidationError):
        parts: list[str] = []
        for item in error.errors(include_input=False)[:5]:
            location = ".".join(str(part) for part in item.get("loc", ())) or "response"
            message = str(item.get("msg", "invalid value"))
            parts.append(f"{location}: {message}")
        return "; ".join(parts) or "validation_error"
    if isinstance(error, LayoutDataError):
        return str(error)[:240]
    return type(error).__name__


class LayoutDataError(ValueError):
    """A layout that binds to data paths the executed sources do not contain."""


_MISSING = object()
_OMITTED = "[nested data omitted]"


def _at_path(value: Any, path: str) -> Any:
    # Mirrors atPath in api/src/modules/assistant/composition.ts.
    current = value
    for part in [segment for segment in (path or "").split(".") if segment]:
        if current == _OMITTED:
            return current
        if isinstance(current, list) and part.isdigit():
            index = int(part)
            if index >= len(current):
                return _MISSING
            current = current[index]
            continue
        if not isinstance(current, dict) or part not in current:
            return _MISSING
        current = current[part]
    return current


def _key_names(record: dict[str, Any]) -> str:
    top = list(record.keys())[:15]
    nested = [
        f"{key}.{child}"
        for key in top
        if isinstance(record.get(key), dict)
        for child in list(record[key].keys())[:6]
    ]
    return ", ".join([*top, *nested[:15]])


def _keys_hint(value: Any) -> str:
    if isinstance(value, dict):
        return "keys " + _key_names(value)
    if isinstance(value, list) and value and isinstance(value[0], dict):
        return "list items with keys " + _key_names(value[0])
    return "no nested keys"


def _nested_key(sample: dict[str, Any], key: Any) -> Any:
    """Return the single nested dot path for a key missing at the top level, else the key unchanged."""
    if not isinstance(key, str) or not key or _at_path(sample, key) is not _MISSING:
        return key
    matches = [
        f"{parent}.{key}"
        for parent, child in sample.items()
        if isinstance(child, dict) and _at_path(child, key) is not _MISSING
    ]
    return matches[0] if len(matches) == 1 else key


_ITEM_KEY_FIELDS = ("xKey", "labelKey", "valueKey", "dateKey", "titleKey", "detailKey")


def _resolve_nested_keys(candidate: dict[str, Any], executed: list[dict[str, Any]]) -> None:
    results = {
        str(source.get("sourceId")): source.get("result")
        for source in executed
        if source.get("status") == "ok"
    }

    def sample_at(source_id: Any, path: Any) -> dict[str, Any] | None:
        if source_id not in results:
            return None
        items = _at_path(results[source_id], path if isinstance(path, str) else "")
        first = items[0] if isinstance(items, list) and items else None
        return first if isinstance(first, dict) else None

    composition = candidate.get("composition")
    sections = composition.get("sections") if isinstance(composition, dict) else None
    for section in sections if isinstance(sections, list) else []:
        blocks = section.get("blocks") if isinstance(section, dict) else None
        for block in blocks if isinstance(blocks, list) else []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "metrics":
                for item in block.get("items") or []:
                    binding = item.get("binding") if isinstance(item, dict) else None
                    if not isinstance(binding, dict) or not binding.get("field"):
                        continue
                    sample = sample_at(binding.get("sourceId"), binding.get("path"))
                    if sample is not None:
                        binding["field"] = _nested_key(sample, binding.get("field"))
                continue
            sample = sample_at(block.get("sourceId"), block.get("path"))
            if sample is None:
                continue
            for field in _ITEM_KEY_FIELDS:
                if field in block:
                    block[field] = _nested_key(sample, block.get(field))
            for entry in [*(block.get("columns") or []), *(block.get("series") or []), block.get("sort")]:
                if isinstance(entry, dict) and "key" in entry:
                    entry["key"] = _nested_key(sample, entry.get("key"))


def _block_data_errors(block: Any, results: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    def check_binding(binding: Any) -> None:
        source_id = getattr(binding, "sourceId", "")
        if source_id not in results:
            errors.append(f'binding source "{source_id}" was not executed')
            return
        value = _at_path(results[source_id], getattr(binding, "path", ""))
        if value is _MISSING:
            errors.append(f'path "{binding.path}" not in {source_id} ({_keys_hint(results[source_id])})')
            return
        field = getattr(binding, "field", None)
        if binding.operation in {"sum", "average", "minimum", "maximum"}:
            if value != _OMITTED and not isinstance(value, list):
                errors.append(f'{binding.operation} on "{binding.path}" in {source_id} needs a list')
            elif field and isinstance(value, list) and value and isinstance(value[0], dict) and _at_path(value[0], field) is _MISSING:
                errors.append(f'field "{field}" not in {source_id}.{binding.path} items ({_keys_hint(value)})')

    block_type = getattr(block, "type", "")
    if block_type == "metrics":
        for item in block.items:
            check_binding(item.binding)
        return errors
    if block_type == "comparison":
        check_binding(block.current)
        check_binding(block.previous)
        return errors
    source_id = getattr(block, "sourceId", None)
    if source_id is None:
        return errors
    if source_id not in results:
        return [f'block source "{source_id}" was not executed']
    items = _at_path(results[source_id], block.path)
    if items is _MISSING or (items != _OMITTED and not isinstance(items, list)):
        return [f'path "{block.path}" in {source_id} is not a list ({_keys_hint(results[source_id])})']
    keys: list[str] = []
    if block_type == "table":
        keys = [column.key for column in block.columns] + ([block.sort.key] if block.sort else [])
    elif block_type == "chart":
        keys = [block.xKey, *[series.key for series in block.series]]
    elif block_type in {"ranked_list", "status_summary"}:
        keys = [block.labelKey, block.valueKey]
    elif block_type == "timeline":
        keys = [block.dateKey, block.titleKey, *([block.detailKey] if block.detailKey else [])]
    sample = items[0] if isinstance(items, list) and items else None
    if isinstance(sample, dict):
        for key in keys:
            if _at_path(sample, key) is _MISSING:
                errors.append(f'key "{key}" not in {source_id}.{block.path or "(root)"} items ({_keys_hint(items)})')
    return errors


def _layout_data_errors(
    response: AssistantChatResponse,
    executed: list[dict[str, Any]],
) -> dict[tuple[int, int], list[str]]:
    if response.composition is None:
        return {}
    results = {
        str(source.get("sourceId")): source.get("result")
        for source in executed
        if source.get("status") == "ok"
    }
    failed = {str(source.get("sourceId")) for source in executed if source.get("status") == "error"}
    problems: dict[tuple[int, int], list[str]] = {}
    for section_index, section in enumerate(response.composition.sections):
        for block_index, block in enumerate(section.blocks):
            referenced = getattr(block, "sourceIds", None) or [getattr(block, "sourceId", "")]
            if any(source_id in failed for source_id in referenced):
                continue
            errors = _block_data_errors(block, results)
            if errors:
                problems[(section_index, block_index)] = errors
    return problems


def _describe_layout_errors(problems: dict[tuple[int, int], list[str]]) -> str:
    parts = [
        f"sections.{section}.blocks.{block}: {'; '.join(errors)}"
        for (section, block), errors in list(problems.items())[:4]
    ]
    return "layout references unavailable data: " + " | ".join(parts)


def _validated_composition(
    candidate: dict[str, Any],
    executed: list[dict[str, Any]],
    *,
    prune: bool,
) -> AssistantChatResponse:
    _resolve_nested_keys(candidate, executed)
    response = AssistantChatResponse.model_validate(candidate)
    problems = _layout_data_errors(response, executed)
    if not problems:
        return response
    if not prune or response.composition is None:
        raise LayoutDataError(_describe_layout_errors(problems))
    sections = []
    for section_index, section in enumerate(response.composition.sections):
        blocks = [block for block_index, block in enumerate(section.blocks) if (section_index, block_index) not in problems]
        if blocks:
            sections.append(section.model_copy(update={"blocks": blocks}))
    if not sections:
        raise LayoutDataError(_describe_layout_errors(problems))
    logger.warning("assistant_layout_pruned %s", _describe_layout_errors(problems)[:500])
    return response.model_copy(update={"composition": response.composition.model_copy(update={"sections": sections})})


def _blood_group(message: str) -> str | None:
    match = re.search(r"(^|[^A-Za-z0-9])((?:AB|A|B|O)[+-])(?=$|[^A-Za-z0-9])", message.upper())
    return match.group(2) if match else None


def _horizon_days(message: str) -> int:
    match = re.search(r"\b(7|14|30|60)\s*(day|days|siku)?\b", message, flags=re.IGNORECASE)
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
            "alert": "/alerts",
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

    if any(word in message for word in ["forecast", "prediction", "analysis", "utabiri", "uchambuzi"]) and any(
        word in message for word in ["run", "create", "generate", "tengeneza", "endesha"]
    ):
        if "ai_analysis.propose_run" in available:
            return _response_from_tool_result(
                client.call_tool(
                    "ai_analysis.propose_run",
                    {"horizonDays": _horizon_days(request.message), "notificationMode": "REPORT_ONLY"},
                ),
                "ai_analysis.propose_run",
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
    except AiServiceError as exc:
        return data_unavailable_response(
            code=exc.code,
            stage="tools",
            message="The assistant cannot connect to the NBTS data tools. Check the API service and API_INTERNAL_BASE_URL, then try again.",
            reason=exc.code,
        )

    try:
        llm = provider or get_llm_provider(cfg)
    except AiServiceError as exc:
        control_text = request.message.lower()
        if re.search(r"\b(open|go to|navigate)\b", control_text) or (
            re.search(r"\b(run|create|generate|tengeneza|endesha)\b", control_text)
            and re.search(r"\b(forecast|prediction|analysis|utabiri|uchambuzi)\b", control_text)
        ):
            try:
                control = _heuristic_tool_response(request, client, tools)
                if control and control.type in {"navigation", "action_proposal"}:
                    return control
            except AiServiceError:
                pass
        return data_unavailable_response(
            code=exc.code,
            stage="provider",
            message="The AI model provider is unavailable or not configured. Check the configured provider credentials and endpoint, then try again.",
            reason=exc.code,
        )

    try:
        history = [
            ChatMessage(role=item.get("role", "user"), content=item.get("content", "")[:2000])
            for item in request.history[-10:]
            if item.get("role") in {"user", "assistant"} and item.get("content")
        ]
        parsed = _plan_request(
            llm,
            [ChatMessage(role="system", content=_system_prompt(request, tools)), *history, ChatMessage(role="user", content=request.message)],
        )
    except AiServiceError as exc:
        return data_unavailable_response(
            code=exc.code,
            stage="planning",
            message="The AI model could not create a valid data-query plan. Please retry the request.",
            reason=exc.message,
        )

    raw_calls = parsed.get("tool_calls")
    if not isinstance(raw_calls, list):
        single = parsed.get("tool_call")
        raw_calls = [single] if isinstance(single, dict) else []

    if raw_calls:
        if len(raw_calls) > 6:
            return data_unavailable_response(
                code="ASSISTANT_TOOL_LIMIT_EXCEEDED",
                stage="planning",
                message="The AI requested too many data sources. Please narrow the question or try again.",
            )
        descriptors = {tool.name: tool for tool in tools}
        executed: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for index, raw_call in enumerate(raw_calls):
            if not isinstance(raw_call, dict):
                return data_unavailable_response(
                    code="ASSISTANT_TOOL_PLAN_INVALID",
                    stage="planning",
                    message="The AI generated an invalid data-query plan. Please retry the request.",
                )
            name = _normalize_tool_name(raw_call.get("name"), set(descriptors))
            arguments = raw_call.get("arguments") or {}
            source_id = _normalize_source_id(raw_call.get("sourceId"), index, seen_ids)
            descriptor = descriptors.get(name)
            if descriptor is None or not isinstance(arguments, dict):
                reason = f"unknown tool {name!r}" if descriptor is None else f"arguments for {name!r} are not an object"
                return data_unavailable_response(
                    code="ASSISTANT_TOOL_PLAN_INVALID",
                    stage="planning",
                    message="The AI generated an invalid data-query plan. Please retry the request.",
                    reason=reason,
                )
            seen_ids.add(source_id)
            if descriptor.mutates and len(raw_calls) != 1:
                return data_unavailable_response(
                    code="ASSISTANT_TOOL_PLAN_INVALID",
                    stage="planning",
                    message="The AI combined a confirmation action with data queries. Please ask for the action on its own.",
                    reason=f"mutating tool {name!r} in a {len(raw_calls)}-call plan",
                )
            try:
                result = client.call_tool(name, arguments)
            except AiServiceError as exc:
                if exc.code == "FORBIDDEN":
                    return AssistantChatResponse(type="permission_denied", message=exc.message, requiredPermission=descriptor.requiredPermission or "unknown")
                executed.append({
                    "sourceId": source_id,
                    "tool": name,
                    "arguments": arguments,
                    "status": "error",
                    "errorCode": exc.code,
                    "error": exc.message,
                })
                continue
            if descriptor.mutates or (isinstance(result, dict) and ("proposal" in result or result.get("type") == "navigation")):
                return _response_from_tool_result(result, name)
            executed.append({"sourceId": source_id, "tool": name, "arguments": arguments, "status": "ok", "result": _compact_result(result)})

        if not any(source.get("status") == "ok" for source in executed):
            failure_codes = sorted({
                str(source.get("errorCode"))
                for source in executed
                if source.get("status") == "error" and source.get("errorCode")
            })
            source_code = failure_codes[0] if len(failure_codes) == 1 else "ASSISTANT_DATA_SOURCES_FAILED"
            validation_details = sorted({
                str(source.get("error"))[:300]
                for source in executed
                if source.get("status") == "error"
                and source.get("errorCode") == "VALIDATION_ERROR"
                and source.get("error")
            })
            message = "The selected NBTS data sources could not be loaded. Check database availability and the API logs, then try again."
            if source_code == "VALIDATION_ERROR" and validation_details:
                message = f"The AI selected an invalid data filter: {validation_details[0]} Please retry or rephrase the request."
            return data_unavailable_response(
                code=source_code,
                stage="data",
                message=message,
                reason=",".join(failure_codes) if failure_codes else "no_successful_sources",
            )

        plan_sources = [
            {"sourceId": source["sourceId"], "tool": source["tool"], "arguments": source["arguments"]}
            for source in executed
        ]
        first_candidate: dict[str, Any] | None = None
        try:
            completion = llm.complete(_composition_messages(request, executed))
            candidate = _parse_json_object(completion.content)
            candidate["sources"] = plan_sources
            first_candidate = candidate
            return _validated_composition(candidate, executed, prune=False)
        except (AiServiceError, ValueError, IndexError) as first_error:
            if _is_model_still_loading(first_error):
                return data_unavailable_response(
                    code=first_error.code,
                    stage="composition",
                    message="The AI model is still loading. Please retry the request in a moment.",
                    reason=first_error.message,
                )
            try:
                repair = llm.complete(_composition_messages(
                    request,
                    executed,
                    repair=str(first_error)[:500],
                ))
                candidate = _parse_json_object(repair.content)
                candidate["sources"] = plan_sources
                return _validated_composition(candidate, executed, prune=True)
            except (AiServiceError, ValueError, IndexError) as repair_error:
                if first_candidate is not None:
                    try:
                        return _validated_composition(first_candidate, executed, prune=True)
                    except (ValueError, IndexError):
                        pass
                validation_summary = _safe_validation_summary(repair_error)
                return data_unavailable_response(
                    code="ASSISTANT_LAYOUT_INVALID",
                    stage="composition",
                    message=f"The AI returned an invalid layout after one repair attempt: {validation_summary}. Please retry or rephrase the request.",
                    reason=validation_summary,
                )

    try:
        return AssistantChatResponse.model_validate(parsed)
    except ValueError as exc:
        return data_unavailable_response(
            code="ASSISTANT_RESPONSE_INVALID",
            stage="planning",
            message="The AI returned an unsupported response. Please retry the request.",
            reason=type(exc).__name__,
        )
