"""Shared test helpers for synthetic demand series."""

from __future__ import annotations

from datetime import date, timedelta


def make_history(
    days: int = 35,
    *,
    start: date | None = None,
    base: float = 5.0,
) -> list[dict[str, object]]:
    origin = start or date(2026, 1, 1)
    points: list[dict[str, object]] = []
    for offset in range(days):
        seasonal = 2.0 if (offset % 7) in {5, 6} else 0.0
        points.append(
            {
                "date": (origin + timedelta(days=offset)).isoformat(),
                "demand_units": base + (offset % 5) + seasonal,
            }
        )
    return points


def make_training_series(
    days: int = 35,
    *,
    blood_group: str = "O+",
    facility_id: str | None = "facility-001",
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for point in make_history(days):
        rows.append(
            {
                "blood_group": blood_group,
                "facility_id": facility_id,
                "date": point["date"],
                "demand_units": point["demand_units"],
            }
        )
    return rows
