/**
 * Predictions data access + AI orchestration (TODO.md §7, docs/04, docs/14).
 *
 * Flow for POST /predictions/run:
 *   optional syncDemand → optional train → forecast → persist ai_predictions
 *   → afterPredictionPersisted hook (shortage-alerts upsert; non-fatal)
 */

import {
  and,
  count,
  desc,
  eq,
  gte,
  lte,
  type SQL,
} from 'drizzle-orm'

import type { Db } from '../../db'
import {
  aiPredictions,
  bloodGroups,
  healthcareFacilities,
} from '../../db/schema'
import type {
  PredictionMetrics,
  StoredPredictionPoint,
  StoredTrainSummary,
} from '../../db/schema/ai-predictions'
import { AppError } from '../../lib/errors'
import { logWarn } from '../../lib/logger'
import {
  createAiClient,
  type AiServiceClient,
  type BloodGroup,
  type ForecastResponse,
  type HistoryPoint,
  type HorizonDays,
  type TrainResponse,
} from '../../services/ai'
import {
  exportDemandSeries,
  syncDemandFromBloodRequests,
  type ExportDemandResult,
  type SyncDemandResult,
} from '../demand'
import {
  noopAfterPredictionPersisted,
  type AfterPredictionPersistedHook,
} from './hooks'
import type {
  LatestPredictionQuery,
  ListPredictionsQuery,
  RunPredictionBody,
} from './schemas'
import {
  buildMetricsJson,
  toDateOnlyString,
  toPublicPrediction,
  type BloodGroupJoinRow,
  type FacilityJoinRow,
  type PredictionRow,
  type PublicPrediction,
} from './serialize'

type LoadedPrediction = {
  prediction: PredictionRow
  bloodGroup: BloodGroupJoinRow | null
  facility: FacilityJoinRow | null
}

export type RunPredictionDeps = {
  /** Injectable AI client (tests mock forecast/train). */
  ai?: AiServiceClient
  /**
   * Shortage-alerts hook — wired from routes via modules/alerts.
   * Failures here are logged and do not fail the prediction run.
   */
  afterPredictionPersisted?: AfterPredictionPersistedHook
  /** Injectable demand export (docs/14 history|series). */
  exportDemand?: (
    db: Db,
    query: Parameters<typeof exportDemandSeries>[1],
  ) => Promise<ExportDemandResult>
  /** Injectable demand sync before forecast. */
  syncDemand?: (
    db: Db,
    body: Parameters<typeof syncDemandFromBloodRequests>[1],
  ) => Promise<SyncDemandResult>
}

export type RunPredictionResult = {
  prediction: PublicPrediction
  forecast: ForecastResponse
  train: TrainResponse | null
  sync: SyncDemandResult | null
}

function mapPredictionRow(
  row: typeof aiPredictions.$inferSelect,
): PredictionRow {
  return {
    id: row.id,
    bloodGroupId: row.bloodGroupId,
    facilityId: row.facilityId ?? null,
    forecastStart: row.forecastStart,
    forecastEnd: row.forecastEnd,
    predictedUnits: row.predictedUnits,
    modelName: row.modelName,
    modelVersion: row.modelVersion ?? null,
    metricsJson: (row.metricsJson as PredictionMetrics | null) ?? null,
    createdAt: row.createdAt,
  }
}

function mapBloodGroupRow(
  row: typeof bloodGroups.$inferSelect | null | undefined,
): BloodGroupJoinRow | null {
  if (!row?.id) {
    return null
  }
  return {
    id: row.id,
    code: row.code,
    abo: row.abo,
    rh: row.rh,
  }
}

function mapFacilityRow(
  row: typeof healthcareFacilities.$inferSelect | null | undefined,
): FacilityJoinRow | null {
  if (!row?.id) {
    return null
  }
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    district: row.district,
  }
}

function toPublicOrThrow(loaded: LoadedPrediction | null): PublicPrediction {
  const publicPrediction = toPublicPrediction(loaded?.prediction, {
    bloodGroup: loaded?.bloodGroup,
    facility: loaded?.facility,
  })
  if (!publicPrediction) {
    throw AppError.internal('Failed to serialize prediction')
  }
  return publicPrediction
}

async function resolveBloodGroup(
  db: Db,
  bloodGroupId: number | undefined,
  bloodGroupCode: string | undefined,
): Promise<{ id: number; code: BloodGroup }> {
  if (typeof bloodGroupId === 'number') {
    const rows = await db
      .select()
      .from(bloodGroups)
      .where(eq(bloodGroups.id, bloodGroupId))
      .limit(1)
    const row = rows?.[0]
    if (!row?.id || !row?.code) {
      throw AppError.validation('Invalid blood group', [
        {
          path: 'bloodGroupId',
          message: 'Blood group does not exist',
          code: 'invalid_blood_group',
        },
      ])
    }
    return { id: row.id, code: row.code as BloodGroup }
  }

  if (bloodGroupCode) {
    const rows = await db
      .select()
      .from(bloodGroups)
      .where(eq(bloodGroups.code, bloodGroupCode))
      .limit(1)
    const row = rows?.[0]
    if (!row?.id || !row?.code) {
      throw AppError.validation('Invalid blood group', [
        {
          path: 'bloodGroup',
          message: 'Blood group does not exist',
          code: 'invalid_blood_group',
        },
      ])
    }
    return { id: row.id, code: row.code as BloodGroup }
  }

  throw AppError.validation('bloodGroup or bloodGroupId is required', [
    {
      path: 'bloodGroup',
      message: 'bloodGroup or bloodGroupId is required',
      code: 'required',
    },
  ])
}

async function assertFacilityExists(
  db: Db,
  facilityId: number,
): Promise<void> {
  const rows = await db
    .select({ id: healthcareFacilities.id })
    .from(healthcareFacilities)
    .where(eq(healthcareFacilities.id, facilityId))
    .limit(1)
  if (!rows?.[0]?.id) {
    throw AppError.validation('Invalid facility', [
      {
        path: 'facilityId',
        message: 'Facility does not exist',
        code: 'invalid_facility',
      },
    ])
  }
}

type PredictionFilters = {
  bloodGroupId?: number
  facilityId?: number
  from?: string
  to?: string
}

function buildPredictionWhere(filters: PredictionFilters): SQL | undefined {
  const parts: SQL[] = []

  if (typeof filters.bloodGroupId === 'number') {
    parts.push(eq(aiPredictions.bloodGroupId, filters.bloodGroupId))
  }
  if (typeof filters.facilityId === 'number') {
    parts.push(eq(aiPredictions.facilityId, filters.facilityId))
  }
  if (filters.from) {
    parts.push(gte(aiPredictions.forecastStart, filters.from))
  }
  if (filters.to) {
    parts.push(lte(aiPredictions.forecastEnd, filters.to))
  }

  if (parts.length === 0) {
    return undefined
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return and(...parts)
}

async function loadPredictionById(
  db: Db,
  id: number,
): Promise<LoadedPrediction | null> {
  const rows = await db
    .select({
      prediction: aiPredictions,
      bloodGroup: bloodGroups,
      facility: healthcareFacilities,
    })
    .from(aiPredictions)
    .leftJoin(bloodGroups, eq(aiPredictions.bloodGroupId, bloodGroups.id))
    .leftJoin(
      healthcareFacilities,
      eq(aiPredictions.facilityId, healthcareFacilities.id),
    )
    .where(eq(aiPredictions.id, id))
    .limit(1)

  const row = rows?.[0]
  if (!row?.prediction?.id) {
    return null
  }

  return {
    prediction: mapPredictionRow(row.prediction),
    bloodGroup: mapBloodGroupRow(row.bloodGroup),
    facility: mapFacilityRow(row.facility),
  }
}

export async function getPredictionById(
  db: Db,
  id: number,
): Promise<PublicPrediction> {
  const loaded = await loadPredictionById(db, id)
  if (!loaded) {
    throw AppError.notFound('Prediction not found')
  }
  return toPublicOrThrow(loaded)
}

export type ListPredictionsResult = {
  items: PublicPrediction[]
  total: number
  limit: number
  offset: number
}

export async function listPredictions(
  db: Db,
  query: ListPredictionsQuery,
): Promise<ListPredictionsResult> {
  const limit = query.limit ?? 100
  const offset = query.offset ?? 0

  let bloodGroupId: number | undefined
  if (query.bloodGroupId !== undefined || query.bloodGroup !== undefined) {
    const resolved = await resolveBloodGroup(
      db,
      query.bloodGroupId,
      query.bloodGroup,
    )
    bloodGroupId = resolved.id
  }
  if (typeof query.facilityId === 'number') {
    await assertFacilityExists(db, query.facilityId)
  }

  const whereClause = buildPredictionWhere({
    bloodGroupId,
    facilityId: query.facilityId,
    from: query.from,
    to: query.to,
  })

  const [totalRow] = await db
    .select({ value: count() })
    .from(aiPredictions)
    .where(whereClause)

  const total = Number(totalRow?.value ?? 0)

  const rows = await db
    .select({
      prediction: aiPredictions,
      bloodGroup: bloodGroups,
      facility: healthcareFacilities,
    })
    .from(aiPredictions)
    .leftJoin(bloodGroups, eq(aiPredictions.bloodGroupId, bloodGroups.id))
    .leftJoin(
      healthcareFacilities,
      eq(aiPredictions.facilityId, healthcareFacilities.id),
    )
    .where(whereClause)
    .orderBy(desc(aiPredictions.createdAt), desc(aiPredictions.id))
    .limit(limit)
    .offset(offset)

  const items = (rows ?? [])
    .map((row) =>
      toPublicPrediction(
        row?.prediction ? mapPredictionRow(row.prediction) : null,
        {
          bloodGroup: mapBloodGroupRow(row?.bloodGroup),
          facility: mapFacilityRow(row?.facility),
        },
      ),
    )
    .filter((item): item is PublicPrediction => item !== null)

  return { items, total, limit, offset }
}

/**
 * Latest persisted forecast for a blood group (optional facility).
 * When facilityId is omitted, returns the latest row for that blood group
 * regardless of facility scope.
 */
export async function getLatestPrediction(
  db: Db,
  query: LatestPredictionQuery,
): Promise<PublicPrediction> {
  const bloodGroup = await resolveBloodGroup(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )
  if (typeof query.facilityId === 'number') {
    await assertFacilityExists(db, query.facilityId)
  }

  const whereClause = buildPredictionWhere({
    bloodGroupId: bloodGroup.id,
    facilityId: query.facilityId,
  })

  const rows = await db
    .select({
      prediction: aiPredictions,
      bloodGroup: bloodGroups,
      facility: healthcareFacilities,
    })
    .from(aiPredictions)
    .leftJoin(bloodGroups, eq(aiPredictions.bloodGroupId, bloodGroups.id))
    .leftJoin(
      healthcareFacilities,
      eq(aiPredictions.facilityId, healthcareFacilities.id),
    )
    .where(whereClause)
    .orderBy(desc(aiPredictions.createdAt), desc(aiPredictions.id))
    .limit(1)

  const row = rows?.[0]
  if (!row?.prediction?.id) {
    throw AppError.notFound('No prediction found for the given filters')
  }

  return toPublicOrThrow({
    prediction: mapPredictionRow(row.prediction),
    bloodGroup: mapBloodGroupRow(row.bloodGroup),
    facility: mapFacilityRow(row.facility),
  })
}

function normalizeHistoryPoints(
  history: HistoryPoint[] | null | undefined,
): HistoryPoint[] {
  const byDate = new Map<string, number>()
  for (const point of history ?? []) {
    const date = point?.date?.trim?.() ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue
    }
    const units = Math.max(0, Number(point.demand_units) || 0)
    byDate.set(date, units)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, demand_units]) => ({ date, demand_units }))
}

function forecastWindow(
  points: StoredPredictionPoint[],
): { start: string; end: string } {
  const dates = points
    .map((p) => p.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
  const start = dates[0]
  const end = dates[dates.length - 1]
  if (!start || !end) {
    throw AppError.badRequest('Forecast response contained no prediction dates', [
      {
        code: 'AI_EMPTY_FORECAST',
        message: 'predictions[] must include at least one dated point',
      },
    ])
  }
  return { start, end }
}

function toStoredSeries(
  forecast: ForecastResponse,
): StoredPredictionPoint[] {
  return (forecast.predictions ?? [])
    .map((point) => {
      const date = toDateOnlyString(point?.date)
      const units = Number(point?.units)
      if (!date || !Number.isFinite(units)) {
        return null
      }
      return { date, units }
    })
    .filter((point): point is StoredPredictionPoint => point !== null)
}

function toTrainSummary(
  train: TrainResponse | null,
): StoredTrainSummary | null {
  if (!train) {
    return null
  }
  return {
    selected_model: train.selected_model,
    model_version: train.model_version,
    metrics: train.metrics ?? null,
    baseline_metrics: train.baseline_metrics ?? null,
  }
}

function formatDecimal(value: number): string {
  return value.toFixed(2)
}

/**
 * Run optional sync/train, call AI forecast, persist, invoke alert hook.
 * AI failures surface as AppError (503/504/422…) via AiServiceClient —
 * they do not crash the process.
 */
export async function runPrediction(
  db: Db,
  body: RunPredictionBody,
  deps: RunPredictionDeps = {},
): Promise<RunPredictionResult> {
  const ai = deps.ai ?? createAiClient()
  const afterPersisted =
    deps.afterPredictionPersisted ?? noopAfterPredictionPersisted
  const exportDemand = deps.exportDemand ?? exportDemandSeries
  const syncDemand = deps.syncDemand ?? syncDemandFromBloodRequests

  const bloodGroup = await resolveBloodGroup(
    db,
    body.bloodGroupId,
    body.bloodGroup,
  )
  const facilityId =
    typeof body.facilityId === 'number' ? body.facilityId : null
  if (typeof facilityId === 'number') {
    await assertFacilityExists(db, facilityId)
  }

  const horizonDays: HorizonDays = body.horizonDays ?? 7
  const facilityIdForAi =
    typeof facilityId === 'number' ? String(facilityId) : null

  let sync: SyncDemandResult | null = null
  if (body.syncDemand) {
    sync = await syncDemand(db, {
      from: body.from,
      to: body.to,
      facilityId: facilityId ?? undefined,
      bloodGroupId: bloodGroup.id,
    })
  }

  let train: TrainResponse | null = null
  if (body.train) {
    const seriesExport = await exportDemand(db, {
      format: 'series',
      bloodGroupId: bloodGroup.id,
      facilityId: facilityId ?? undefined,
      from: body.from,
      to: body.to,
    })
    if (seriesExport.format !== 'series') {
      throw AppError.internal('Unexpected demand export format for train')
    }
    if (!seriesExport.series?.length) {
      throw AppError.badRequest(
        'Insufficient demand history to train a model',
        [
          {
            code: 'INSUFFICIENT_HISTORY',
            message: 'No demand series rows available for training',
            path: 'train',
          },
        ],
      )
    }
    train = await ai.train({
      series: seriesExport.series,
      candidate_models: body.candidateModels,
    })
  }

  let history: HistoryPoint[]
  if (body.history?.length) {
    history = normalizeHistoryPoints(body.history)
  } else {
    const historyExport = await exportDemand(db, {
      format: 'history',
      bloodGroupId: bloodGroup.id,
      facilityId: facilityId ?? undefined,
      from: body.from,
      to: body.to,
    })
    if (historyExport.format !== 'history') {
      throw AppError.internal('Unexpected demand export format for forecast')
    }
    history = normalizeHistoryPoints(historyExport.history)
  }

  if (!history.length) {
    throw AppError.badRequest('Insufficient demand history for forecast', [
      {
        code: 'INSUFFICIENT_HISTORY',
        message:
          'Provide history[] or ensure demand_records exist for this blood group',
        path: 'history',
      },
    ])
  }

  const preferredModel = body.preferredModel

  const forecast = await ai.forecast({
    blood_group: bloodGroup.code,
    facility_id: facilityIdForAi,
    horizon_days: horizonDays,
    history,
    ...(preferredModel ? { preferred_model: preferredModel } : {}),
  })

  const series = toStoredSeries(forecast)
  if (!series.length) {
    throw AppError.badRequest('AI forecast returned no prediction points', [
      {
        code: 'AI_EMPTY_FORECAST',
        message: 'predictions[] was empty',
      },
    ])
  }

  const window = forecastWindow(series)
  const predictedUnits = Number.isFinite(forecast.total_predicted_units)
    ? Number(forecast.total_predicted_units)
    : series.reduce((sum, point) => sum + point.units, 0)

  const metricsJson = buildMetricsJson({
    mae: forecast.metrics?.mae ?? null,
    rmse: forecast.metrics?.rmse ?? null,
    wape: forecast.metrics?.wape ?? null,
    horizonDays: forecast.horizon_days ?? horizonDays,
    predictions: series,
    train: toTrainSummary(train),
  })

  const inserted = await db
    .insert(aiPredictions)
    .values({
      bloodGroupId: bloodGroup.id,
      facilityId,
      forecastStart: window.start,
      forecastEnd: window.end,
      predictedUnits: formatDecimal(predictedUnits),
      modelName: forecast.model?.trim() || train?.selected_model || 'unknown',
      modelVersion:
        forecast.model_version?.trim() || train?.model_version || null,
      metricsJson,
    })
    .$returningId()

  const insertId = inserted?.[0]?.id
  if (typeof insertId !== 'number' || !Number.isFinite(insertId)) {
    throw AppError.internal('Failed to persist prediction')
  }

  const prediction = await getPredictionById(db, insertId)

  try {
    await afterPersisted({
      prediction,
      forecast,
      bloodGroupId: bloodGroup.id,
      facilityId,
    })
  } catch (error) {
    logWarn('afterPredictionPersisted hook failed (non-fatal)', {
      predictionId: prediction.id,
      reason:
        error instanceof Error ? error.message : 'unknown hook failure',
    })
  }

  return {
    prediction,
    forecast,
    train,
    sync,
  }
}
