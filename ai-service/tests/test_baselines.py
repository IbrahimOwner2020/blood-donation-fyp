"""Baseline model unit tests."""

from __future__ import annotations

from app.training.baselines import forecast_baseline


def test_historical_average_is_constant() -> None:
    values = [1.0, 3.0, 5.0, 7.0]
    preds = forecast_baseline(values, 3, model_name="historical_average")
    assert preds == [4.0, 4.0, 4.0]


def test_moving_average_horizon_length() -> None:
    values = [float(i) for i in range(1, 15)]
    preds = forecast_baseline(values, 7, model_name="moving_average", window=7)
    assert len(preds) == 7
    assert all(isinstance(value, float) for value in preds)


def test_seasonal_naive_repeats_weekly_pattern() -> None:
    values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
    preds = forecast_baseline(values, 7, model_name="seasonal_naive", season=7)
    assert preds == values
