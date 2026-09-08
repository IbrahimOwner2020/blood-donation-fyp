"""Time-series preprocessing for blood demand history."""

from __future__ import annotations

from datetime import date

import pandas as pd

from app.config import Settings, get_settings
from app.errors import insufficient_history
from app.schemas import BloodGroup, HistoryPoint, TrainingSeriesPoint


REQUIRED_COLUMNS = ("date", "demand_units")


def history_to_frame(history: list[HistoryPoint]) -> pd.DataFrame:
    rows = [
        {
            "date": point.date,
            "demand_units": point.demand_units,
        }
        for point in history
    ]
    return _normalize_frame(pd.DataFrame(rows))


def training_series_to_frame(
    series: list[TrainingSeriesPoint],
    *,
    blood_group: BloodGroup | None = None,
    facility_id: str | None = None,
) -> pd.DataFrame:
    filtered = series
    if blood_group is not None:
        filtered = [row for row in filtered if row.blood_group == blood_group]
    if facility_id is not None:
        filtered = [
            row
            for row in filtered
            if (row.facility_id or None) == facility_id
        ]

    rows = [
        {
            "date": point.date,
            "demand_units": point.demand_units,
            "blood_group": point.blood_group.value,
            "facility_id": point.facility_id,
        }
        for point in filtered
    ]
    return _normalize_frame(pd.DataFrame(rows))


def _normalize_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=list(REQUIRED_COLUMNS))

    working = frame.copy()
    if "date" not in working.columns or "demand_units" not in working.columns:
        missing = [col for col in REQUIRED_COLUMNS if col not in working.columns]
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    working["date"] = pd.to_datetime(working["date"], errors="coerce").dt.normalize()
    working["demand_units"] = pd.to_numeric(working["demand_units"], errors="coerce")
    working = working.dropna(subset=["date", "demand_units"])
    working = working[working["demand_units"] >= 0]
    working = working.sort_values("date")
    working = working.drop_duplicates(subset=["date"], keep="last")
    working = working.reset_index(drop=True)
    return working


def ensure_min_history(
    frame: pd.DataFrame,
    *,
    settings: Settings | None = None,
) -> pd.DataFrame:
    cfg = settings or get_settings()
    actual = int(len(frame))
    required = int(cfg.min_training_rows)
    if actual < required:
        raise insufficient_history(required=required, actual=actual)
    return frame


def last_history_date(frame: pd.DataFrame) -> date:
    if frame.empty:
        raise ValueError("Cannot read last date from empty history.")
    value = frame["date"].iloc[-1]
    timestamp = pd.Timestamp(value)
    return timestamp.date()


def demand_values(frame: pd.DataFrame) -> list[float]:
    return [float(value) for value in frame["demand_units"].tolist()]
