"""Model artifact persistence under MODEL_DIR."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import TypeAlias, cast

import joblib
from sklearn.base import RegressorMixin

from app.config import Settings, get_settings
from app.errors import model_not_found
from app.schemas import BloodGroup, Metrics, ModelMetricsResponse, ModelSummary


_SAFE_ID = re.compile(r"[^a-zA-Z0-9._+-]+")

ESTIMATOR_FILENAME = "model.joblib"

JsonScalar: TypeAlias = str | int | float | bool | None
ArtifactParamValue: TypeAlias = JsonScalar | list[str] | list[int] | list[float]
ArtifactParams: TypeAlias = dict[str, ArtifactParamValue]


@dataclass
class ModelArtifact:
    model_id: str
    model_name: str
    model_version: str
    blood_group: str | None = None
    facility_id: str | None = None
    trained_at: str | None = None
    training_start: str | None = None
    training_end: str | None = None
    features: list[str] = field(default_factory=lambda: ["demand_units"])
    target: str = "demand_units"
    horizon_days: int | None = None
    metrics: dict[str, float | None] = field(default_factory=dict)
    baseline_metrics: dict[str, float | None] = field(default_factory=dict)
    params: ArtifactParams = field(default_factory=dict)
    estimator_file: str | None = None

    def to_summary(self) -> ModelSummary:
        return ModelSummary(
            model_id=self.model_id,
            model_name=self.model_name,
            model_version=self.model_version,
            blood_group=BloodGroup(self.blood_group) if self.blood_group else None,
            facility_id=self.facility_id,
            trained_at=self.trained_at,
            training_start=_parse_date(self.training_start),
            training_end=_parse_date(self.training_end),
            features=list(self.features or []),
            target=self.target or "demand_units",
            horizon_days=self.horizon_days,
            metrics=_metrics_from_dict(self.metrics),
        )

    def to_metrics_response(self) -> ModelMetricsResponse:
        return ModelMetricsResponse(
            model_id=self.model_id,
            model_name=self.model_name,
            model_version=self.model_version,
            metrics=_metrics_from_dict(self.metrics) or Metrics(),
            baseline_metrics=_metrics_from_dict(self.baseline_metrics),
            training_start=_parse_date(self.training_start),
            training_end=_parse_date(self.training_end),
            features=list(self.features or []),
            target=self.target or "demand_units",
            horizon_days=self.horizon_days,
        )


def ensure_model_dir(settings: Settings | None = None) -> Path:
    cfg = settings or get_settings()
    path = Path(cfg.model_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def make_model_version(when: datetime | None = None) -> str:
    stamp = when or datetime.now(timezone.utc)
    return stamp.strftime("%Y-%m-%d-%H%M%S")


def make_model_id(model_name: str, model_version: str) -> str:
    raw = f"{model_name}-{model_version}"
    return _SAFE_ID.sub("-", raw)


def save_artifact(
    artifact: ModelArtifact,
    settings: Settings | None = None,
    *,
    estimator: RegressorMixin | None = None,
) -> Path:
    root = ensure_model_dir(settings)
    target = root / artifact.model_id
    target.mkdir(parents=True, exist_ok=True)

    if estimator is not None:
        estimator_path = target / ESTIMATOR_FILENAME
        joblib.dump(estimator, estimator_path)
        artifact.estimator_file = ESTIMATOR_FILENAME

    metadata_path = target / "metadata.json"
    metadata_path.write_text(
        json.dumps(asdict(artifact), indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return metadata_path


def load_artifact(model_id: str, settings: Settings | None = None) -> ModelArtifact:
    root = ensure_model_dir(settings)
    metadata_path = root / model_id / "metadata.json"
    if not metadata_path.is_file():
        raise model_not_found(model_id)
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    return _artifact_from_payload(payload)


def load_estimator(
    model_id: str,
    settings: Settings | None = None,
    *,
    artifact: ModelArtifact | None = None,
) -> RegressorMixin:
    """Load a persisted sklearn estimator for an ML artifact."""
    meta = artifact or load_artifact(model_id, settings=settings)
    root = ensure_model_dir(settings)
    filename = meta.estimator_file or ESTIMATOR_FILENAME
    estimator_path = root / model_id / filename
    if not estimator_path.is_file():
        raise model_not_found(model_id)
    loaded = joblib.load(estimator_path)
    if not hasattr(loaded, "predict"):
        raise model_not_found(model_id)
    return cast(RegressorMixin, loaded)


def list_artifacts(settings: Settings | None = None) -> list[ModelArtifact]:
    root = ensure_model_dir(settings)
    artifacts: list[ModelArtifact] = []
    for child in sorted(root.iterdir()):
        metadata_path = child / "metadata.json"
        if not metadata_path.is_file():
            continue
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
            artifacts.append(_artifact_from_payload(payload))
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            continue
    return artifacts


def latest_artifact(
    *,
    blood_group: str | None = None,
    facility_id: str | None = None,
    settings: Settings | None = None,
) -> ModelArtifact | None:
    candidates = list_artifacts(settings)
    filtered: list[ModelArtifact] = []
    for artifact in candidates:
        if blood_group is not None and artifact.blood_group not in (None, blood_group):
            continue
        if facility_id is not None and artifact.facility_id not in (None, facility_id):
            continue
        filtered.append(artifact)
    if not filtered:
        return None
    filtered.sort(key=lambda item: item.trained_at or item.model_version or "", reverse=True)
    return filtered[0]


def latest_baseline_artifact(
    *,
    blood_group: str | None = None,
    facility_id: str | None = None,
    settings: Settings | None = None,
) -> ModelArtifact | None:
    """Compatibility alias for :func:`latest_artifact`."""
    return latest_artifact(
        blood_group=blood_group,
        facility_id=facility_id,
        settings=settings,
    )


def _artifact_from_payload(payload: dict[str, object]) -> ModelArtifact:
    """Construct a ModelArtifact from JSON metadata with defensive defaults."""
    metrics_raw = payload.get("metrics")
    baseline_raw = payload.get("baseline_metrics")
    params_raw = payload.get("params")
    features_raw = payload.get("features")

    metrics = _coerce_metric_dict(metrics_raw)
    baseline_metrics = _coerce_metric_dict(baseline_raw)
    params = _coerce_params(params_raw)
    features = (
        [str(item) for item in features_raw]
        if isinstance(features_raw, list)
        else ["demand_units"]
    )

    estimator_file_raw = payload.get("estimator_file")
    estimator_file = str(estimator_file_raw) if isinstance(estimator_file_raw, str) else None

    horizon_raw = payload.get("horizon_days")
    horizon_days = int(horizon_raw) if isinstance(horizon_raw, (int, float)) else None

    return ModelArtifact(
        model_id=str(payload.get("model_id") or ""),
        model_name=str(payload.get("model_name") or ""),
        model_version=str(payload.get("model_version") or ""),
        blood_group=_optional_str(payload.get("blood_group")),
        facility_id=_optional_str(payload.get("facility_id")),
        trained_at=_optional_str(payload.get("trained_at")),
        training_start=_optional_str(payload.get("training_start")),
        training_end=_optional_str(payload.get("training_end")),
        features=features,
        target=str(payload.get("target") or "demand_units"),
        horizon_days=horizon_days,
        metrics=metrics,
        baseline_metrics=baseline_metrics,
        params=params,
        estimator_file=estimator_file,
    )


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def _coerce_metric_dict(value: object) -> dict[str, float | None]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, float | None] = {}
    for key, raw in value.items():
        if raw is None:
            result[str(key)] = None
        elif isinstance(raw, (int, float)):
            result[str(key)] = float(raw)
        else:
            result[str(key)] = None
    return result


def _coerce_params(value: object) -> ArtifactParams:
    if not isinstance(value, dict):
        return {}
    result: ArtifactParams = {}
    for key, raw in value.items():
        name = str(key)
        if raw is None or isinstance(raw, (str, int, float, bool)):
            result[name] = raw
        elif isinstance(raw, list) and all(isinstance(item, str) for item in raw):
            result[name] = [str(item) for item in raw]
        elif isinstance(raw, list) and all(
            isinstance(item, int) and not isinstance(item, bool) for item in raw
        ):
            result[name] = [int(item) for item in raw]
        elif isinstance(raw, list) and all(
            isinstance(item, (int, float)) and not isinstance(item, bool) for item in raw
        ):
            result[name] = [float(item) for item in raw]
    return result


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def _metrics_from_dict(payload: dict[str, float | None] | None) -> Metrics | None:
    if not payload:
        return None
    return Metrics(
        mae=payload.get("mae"),
        rmse=payload.get("rmse"),
        wape=payload.get("wape"),
    )
