"""Unit tests for evaluation metrics."""

from __future__ import annotations

import math

from app.evaluation.metrics import compute_metrics, mae, rmse, wape


def test_mae_rmse_known_values() -> None:
    actual = [1.0, 2.0, 3.0]
    predicted = [1.0, 3.0, 5.0]
    assert mae(actual, predicted) == 1.0
    assert math.isclose(rmse(actual, predicted), math.sqrt(5.0 / 3.0))


def test_wape_and_zero_safe() -> None:
    assert math.isclose(wape([2.0, 4.0], [1.0, 5.0]) or -1.0, 1.0 / 3.0)
    assert wape([0.0, 0.0], [1.0, 2.0]) is None


def test_compute_metrics_includes_wape() -> None:
    metrics = compute_metrics([10.0, 20.0, 30.0], [12.0, 18.0, 27.0])
    assert metrics.mae is not None
    assert metrics.rmse is not None
    assert metrics.wape is not None
    assert metrics.mae > 0
    assert metrics.rmse > 0
    assert 0.0 < metrics.wape < 1.0


def test_compute_metrics_rejects_length_mismatch() -> None:
    try:
        compute_metrics([1.0, 2.0], [1.0])
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "length mismatch" in str(exc)


def test_empty_series_mae_is_nan() -> None:
    assert math.isnan(mae([], []))
    assert math.isnan(rmse([], []))
