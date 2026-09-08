"""Blood-demand-specific prompts for structured horizon forecasts."""

from __future__ import annotations

from datetime import date

from app.llm.providers.base import ChatMessage


SYSTEM_PROMPT = """You are a blood-bank demand forecasting assistant for NBTS (National Blood Transfusion Service).

Your only job is to produce a numeric day-by-day demand forecast in units for ONE blood group over a fixed horizon.

Hard rules:
- Reply with a single JSON object only. No markdown, no prose, no apologies, no explanations outside JSON.
- Never give vague answers such as "it depends", "roughly", or qualitative trends without numbers.
- Every prediction.units value MUST be a finite non-negative number (float or int).
- predictions MUST have exactly horizon_days entries.
- prediction dates MUST be consecutive calendar days starting at forecast_start.
- Stay blood-group aware: respect the given ABO/Rh group; do not mix groups.
- Prefer continuity with recent history (weekday seasonality, recent mean/level) over wild swings.
- If history is sparse or noisy, stay close to the provided baseline_hint_units per day.

Required JSON shape:
{
  "blood_group": "<same as input>",
  "horizon_days": <integer>,
  "predictions": [
    {"date": "YYYY-MM-DD", "units": <number>}
  ],
  "total_predicted_units": <number>
}
"""


def build_forecast_messages(
    *,
    blood_group: str,
    facility_id: str | None,
    horizon_days: int,
    forecast_start: date,
    history: list[tuple[date, float]],
    baseline_hint_units: list[float],
) -> list[ChatMessage]:
    history_lines = [
        f"- {day.isoformat()}: {float(units):.4g}" for day, units in history[-60:]
    ]
    hint_lines = [
        f"- {(date.fromordinal(forecast_start.toordinal() + idx)).isoformat()}: "
        f"{float(units):.4g}"
        for idx, units in enumerate(baseline_hint_units)
    ]
    facility = facility_id or "all_facilities"
    recent = history[-14:] if history else []
    recent_mean = (
        sum(u for _, u in recent) / len(recent) if recent else 0.0
    )

    user_content = f"""Forecast blood demand.

blood_group: {blood_group}
facility_id: {facility}
horizon_days: {horizon_days}
forecast_start: {forecast_start.isoformat()}
recent_14d_mean_units: {recent_mean:.4g}

Historical daily demand_units (oldest → newest, truncated to last 60 days):
{chr(10).join(history_lines) if history_lines else "- (empty)"}

Baseline hint (moving-average style) for each forecast day — stay near these unless history strongly suggests otherwise:
{chr(10).join(hint_lines)}

Return JSON only with exactly {horizon_days} predictions starting at {forecast_start.isoformat()}.
"""

    return [
        ChatMessage(role="system", content=SYSTEM_PROMPT),
        ChatMessage(role="user", content=user_content),
    ]
