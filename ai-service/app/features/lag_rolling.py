"""Lag and rolling window features for tree-based demand models.

Aligned with docs/07-ai-service-specification.md:
lag 1/7/14, rolling mean 7/14, and calendar fields (dow, month, week).
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

FEATURE_COLUMNS: tuple[str, ...] = (
    "dow",
    "month",
    "weekofyear",
    "lag_1",
    "lag_7",
    "lag_14",
    "roll_mean_7",
    "roll_mean_14",
)

MIN_HISTORY_FOR_FEATURES = 15


def build_feature_frame(
    dates: list[date] | pd.Series,
    values: list[float] | pd.Series,
    *,
    dropna: bool = True,
) -> pd.DataFrame:
    """Build a chronologically ordered feature frame for supervised learning."""
    frame = pd.DataFrame(
        {
            "date": list(dates),
            "demand_units": list(values),
        }
    )
    if frame.empty:
        return pd.DataFrame(columns=["date", "demand_units", *FEATURE_COLUMNS])

    frame["date"] = pd.to_datetime(frame["date"], errors="coerce").dt.normalize()
    frame["demand_units"] = pd.to_numeric(frame["demand_units"], errors="coerce")
    frame = frame.dropna(subset=["date", "demand_units"]).sort_values("date")
    frame = frame.drop_duplicates(subset=["date"], keep="last").reset_index(drop=True)
    if frame.empty:
        return pd.DataFrame(columns=["date", "demand_units", *FEATURE_COLUMNS])

    timestamps = pd.DatetimeIndex(frame["date"])
    frame["dow"] = timestamps.dayofweek.astype(float)
    frame["month"] = timestamps.month.astype(float)
    # isocalendar().week is indexed by timestamp; align by position to RangeIndex.
    frame["weekofyear"] = (
        timestamps.isocalendar().week.astype(float).to_numpy()
    )

    demand = frame["demand_units"].astype(float)
    frame["lag_1"] = demand.shift(1)
    frame["lag_7"] = demand.shift(7)
    frame["lag_14"] = demand.shift(14)
    frame["roll_mean_7"] = demand.shift(1).rolling(window=7, min_periods=7).mean()
    frame["roll_mean_14"] = demand.shift(1).rolling(window=14, min_periods=14).mean()

    if dropna:
        frame = frame.dropna(subset=list(FEATURE_COLUMNS)).reset_index(drop=True)
    return frame


def feature_matrix(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(X, y)`` arrays from a feature frame."""
    if frame.empty:
        return np.empty((0, len(FEATURE_COLUMNS))), np.empty((0,))
    x = frame.loc[:, list(FEATURE_COLUMNS)].to_numpy(dtype=float)
    y = frame.loc[:, "demand_units"].to_numpy(dtype=float)
    return x, y


def latest_feature_row(
    dates: list[date],
    values: list[float],
    *,
    next_date: date | None = None,
) -> np.ndarray:
    """Build the feature vector for the next forecast step.

    Uses observed (and previously predicted) demand history. When ``next_date``
    is omitted, uses ``last_date + 1 day``.
    """
    if len(dates) != len(values):
        raise ValueError("dates and values must have the same length")
    if len(values) < MIN_HISTORY_FOR_FEATURES:
        raise ValueError(
            f"At least {MIN_HISTORY_FOR_FEATURES} history points are required "
            "to build lag/rolling features."
        )

    last_date = dates[-1]
    target_date = next_date or (last_date + timedelta(days=1))
    # Append a placeholder demand for the target row; lags/rolls use prior values only.
    extended_dates = list(dates) + [target_date]
    extended_values = list(values) + [0.0]
    featured = build_feature_frame(extended_dates, extended_values, dropna=False)
    if featured.empty:
        raise ValueError("Unable to build feature row from history.")

    row = featured.iloc[-1]
    missing = [name for name in FEATURE_COLUMNS if pd.isna(row[name])]
    if missing:
        raise ValueError(f"Incomplete feature row; missing: {', '.join(missing)}")
    return row.loc[list(FEATURE_COLUMNS)].to_numpy(dtype=float)
