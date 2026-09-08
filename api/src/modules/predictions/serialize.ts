/**
 * Public prediction DTOs (docs/04 predictions/, docs/06 ai_predictions).
 */

import type {
  PredictionMetrics,
  StoredPredictionPoint,
  StoredTrainSummary,
} from '../../db/schema/ai-predictions'

export type PublicBloodGroupSummary = {
  id: number
  code: string
  abo: string
  rh: string
}

export type PublicFacilitySummary = {
  id: number
  name: string
  region: string
  district: string
}

export type PublicPrediction = {
  id: number
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  facilityId: number | null
  facility: PublicFacilitySummary | null
  forecastStart: string
  forecastEnd: string
  predictedUnits: number
  modelName: string
  modelVersion: string | null
  metrics: PredictionMetrics | null
  /** Daily series from metrics_json (docs/14 predictions[]). */
  series: StoredPredictionPoint[]
  createdAt: Date
}

export type PredictionRow = {
  id: number
  bloodGroupId: number
  facilityId: number | null
  forecastStart: Date | string
  forecastEnd: Date | string
  predictedUnits: string | number
  modelName: string
  modelVersion: string | null
  metricsJson: PredictionMetrics | null
  createdAt: Date
}

export type BloodGroupJoinRow = {
  id: number
  code: string
  abo: string
  rh: string
}

export type FacilityJoinRow = {
  id: number
  name: string
  region: string
  district: string
}

export function toDateOnlyString(value: Date | string | null | undefined): string {
  if (value == null) {
    return ''
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10)
    }
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) {
      return ''
    }
    return parsed.toISOString().slice(0, 10)
  }
  if (Number.isNaN(value.getTime())) {
    return ''
  }
  return value.toISOString().slice(0, 10)
}

export function toPredictedUnitsNumber(
  value: string | number | null | undefined,
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function toPublicBloodGroupSummary(
  row: BloodGroupJoinRow | null | undefined,
): PublicBloodGroupSummary | null {
  if (!row?.id || !row?.code) {
    return null
  }
  return {
    id: row.id,
    code: row.code,
    abo: row.abo ?? '',
    rh: row.rh ?? '',
  }
}

export function toPublicFacilitySummary(
  row: FacilityJoinRow | null | undefined,
): PublicFacilitySummary | null {
  if (!row?.id) {
    return null
  }
  return {
    id: row.id,
    name: row.name ?? '',
    region: row.region ?? '',
    district: row.district ?? '',
  }
}

function normalizeSeries(
  metrics: PredictionMetrics | null | undefined,
): StoredPredictionPoint[] {
  const points = metrics?.predictions
  if (!Array.isArray(points)) {
    return []
  }
  return points
    .map((point) => {
      const date = typeof point?.date === 'string' ? point.date.trim() : ''
      const units = Number(point?.units)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(units)) {
        return null
      }
      return { date, units }
    })
    .filter((point): point is StoredPredictionPoint => point !== null)
}

export function toPublicPrediction(
  row: PredictionRow | null | undefined,
  relations: {
    bloodGroup?: BloodGroupJoinRow | null
    facility?: FacilityJoinRow | null
  } = {},
): PublicPrediction | null {
  if (!row?.id) {
    return null
  }

  const metrics = row.metricsJson ?? null

  return {
    id: row.id,
    bloodGroupId: row.bloodGroupId,
    bloodGroup: toPublicBloodGroupSummary(relations.bloodGroup),
    facilityId: row.facilityId ?? null,
    facility: toPublicFacilitySummary(relations.facility),
    forecastStart: toDateOnlyString(row.forecastStart),
    forecastEnd: toDateOnlyString(row.forecastEnd),
    predictedUnits: toPredictedUnitsNumber(row.predictedUnits),
    modelName: row.modelName ?? '',
    modelVersion: row.modelVersion ?? null,
    metrics,
    series: normalizeSeries(metrics),
    createdAt: row.createdAt,
  }
}

export function buildMetricsJson(input: {
  mae?: number | null
  rmse?: number | null
  wape?: number | null
  horizonDays: number
  predictions: StoredPredictionPoint[]
  train?: StoredTrainSummary | null
}): PredictionMetrics {
  return {
    mae: input.mae ?? null,
    rmse: input.rmse ?? null,
    wape: input.wape ?? null,
    horizon_days: input.horizonDays,
    predictions: input.predictions,
    train: input.train ?? null,
  }
}
