"""Lag/rolling feature construction tests."""

from __future__ import annotations

from datetime import date, timedelta

from app.features.lag_rolling import (
    FEATURE_COLUMNS,
    build_feature_frame,
    feature_matrix,
    latest_feature_row,
)


def _series(days: int = 40) -> tuple[list[date], list[float]]:
    start = date(2026, 1, 1)
    dates = [start + timedelta(days=offset) for offset in range(days)]
    values = [float(5 + (offset % 5) + (2 if offset % 7 in {5, 6} else 0)) for offset in range(days)]
    return dates, values


def test_build_feature_frame_drops_warmup_and_keeps_columns() -> None:
    dates, values = _series(40)
    frame = build_feature_frame(dates, values, dropna=True)
    assert list(FEATURE_COLUMNS) == [
        "dow",
        "month",
        "weekofyear",
        "lag_1",
        "lag_7",
        "lag_14",
        "roll_mean_7",
        "roll_mean_14",
    ]
    for column in FEATURE_COLUMNS:
        assert column in frame.columns
    # lag_14 / roll_mean_14 require 14 prior observations → first usable index is 14
    assert len(frame) == 40 - 14
    assert not frame[list(FEATURE_COLUMNS)].isna().any().any()


def test_feature_matrix_shapes() -> None:
    dates, values = _series(35)
    frame = build_feature_frame(dates, values)
    x, y = feature_matrix(frame)
    assert x.shape[0] == y.shape[0]
    assert x.shape[1] == len(FEATURE_COLUMNS)


def test_latest_feature_row_length() -> None:
    dates, values = _series(30)
    row = latest_feature_row(dates, values)
    assert row.shape == (len(FEATURE_COLUMNS),)
