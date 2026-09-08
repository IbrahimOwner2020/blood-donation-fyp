"""Parse and validate structured LLM forecast JSON."""

from __future__ import annotations

import json
import math
import re
from datetime import date, timedelta
from typing import Any

from app.errors import AiServiceError


_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise AiServiceError(
            code="LLM_INVALID_RESPONSE",
            message="LLM returned an empty response; numeric JSON forecast required.",
            status_code=502,
        )

    candidates = [raw]
    if raw.startswith("```"):
        fenced = raw.strip("`")
        # strip optional language tag
        if "\n" in fenced:
            fenced = fenced.split("\n", 1)[1]
        candidates.insert(0, fenced.strip())

    match = _JSON_OBJECT_RE.search(raw)
    if match:
        candidates.append(match.group(0))

    last_error: Exception | None = None
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError as exc:
            last_error = exc
            continue
        if isinstance(parsed, dict):
            return parsed

    raise AiServiceError(
        code="LLM_INVALID_RESPONSE",
        message=(
            "LLM did not return a valid JSON object forecast. "
            "Vague or non-numeric answers are rejected."
        ),
        status_code=502,
    ) from last_error


def parse_forecast_units(
    payload: dict[str, Any],
    *,
    horizon_days: int,
    forecast_start: date,
    blood_group: str | None = None,
) -> list[float]:
    if not isinstance(payload, dict):
        raise AiServiceError(
            code="LLM_INVALID_RESPONSE",
            message="LLM forecast payload must be a JSON object.",
            status_code=502,
        )

    predictions = payload.get("predictions")
    if not isinstance(predictions, list) or not predictions:
        raise AiServiceError(
            code="LLM_INVALID_RESPONSE",
            message="LLM forecast missing predictions[]; vague answers are rejected.",
            status_code=502,
        )

    if len(predictions) != horizon_days:
        # Allow truncated/overlong if we can coerce by index order when dates align
        if len(predictions) < horizon_days:
            raise AiServiceError(
                code="LLM_INVALID_RESPONSE",
                message=(
                    f"LLM returned {len(predictions)} predictions; "
                    f"expected exactly {horizon_days}."
                ),
                status_code=502,
            )
        predictions = predictions[:horizon_days]

    expected_bg = (blood_group or "").strip()
    returned_bg = payload.get("blood_group")
    if expected_bg and isinstance(returned_bg, str) and returned_bg.strip():
        if returned_bg.strip() != expected_bg:
            raise AiServiceError(
                code="LLM_INVALID_RESPONSE",
                message=(
                    f"LLM blood_group '{returned_bg}' does not match requested "
                    f"'{expected_bg}'."
                ),
                status_code=502,
            )

    units: list[float] = []
    for offset, item in enumerate(predictions):
        if not isinstance(item, dict):
            raise AiServiceError(
                code="LLM_INVALID_RESPONSE",
                message=f"Prediction at index {offset} must be an object with units.",
                status_code=502,
            )

        expected_day = forecast_start + timedelta(days=offset)
        raw_date = item.get("date")
        if isinstance(raw_date, str) and raw_date.strip():
            try:
                parsed_day = date.fromisoformat(raw_date.strip()[:10])
            except ValueError as exc:
                raise AiServiceError(
                    code="LLM_INVALID_RESPONSE",
                    message=f"Invalid prediction date '{raw_date}' at index {offset}.",
                    status_code=502,
                ) from exc
            if parsed_day != expected_day:
                # Soft: accept if units are present; dates are normalized by service
                pass

        value = _coerce_non_negative_float(item.get("units"), index=offset)
        units.append(value)

    if any(math.isnan(v) or math.isinf(v) for v in units):
        raise AiServiceError(
            code="LLM_INVALID_RESPONSE",
            message="LLM forecast contained NaN/Inf units; rejected.",
            status_code=502,
        )

    return units


def _coerce_non_negative_float(value: object, *, index: int) -> float:
    if isinstance(value, bool) or value is None:
        raise AiServiceError(
            code="LLM_INVALID_RESPONSE",
            message=f"Prediction units missing or invalid at index {index}.",
            status_code=502,
        )
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str) and value.strip():
        try:
            number = float(value.strip())
        except ValueError as exc:
            raise AiServiceError(
                code="LLM_INVALID_RESPONSE",
                message=f"Non-numeric prediction units at index {index}: {value!r}.",
                status_code=502,
            ) from exc
    else:
        raise AiServiceError(
            code="LLM_INVALID_RESPONSE",
            message=f"Non-numeric prediction units at index {index}.",
            status_code=502,
        )

    if number < 0:
        number = 0.0
    return number
