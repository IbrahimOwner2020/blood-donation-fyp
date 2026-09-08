/**
 * Shortage alerts persistence — gap upsert, list/detail, status lifecycle,
 * recalculate (docs/04 alerts/, docs/08, TODO.md §7).
 *
 * Donor matching is on-demand via GET /alerts/:id/matches (matching-service).
 * Post-upsert hook only logs match count — see matching.ts.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  type SQL,
} from 'drizzle-orm'

import type { Db } from '../../db'
import {
  bloodGroups,
  healthcareFacilities,
  shortageAlerts,
} from '../../db/schema'
import type { AlertSeverity, AlertStatus } from '../../db/schema/enums'
import { AppError } from '../../lib/errors'
import {
  DEFAULT_EXPIRING_WITHIN_DAYS,
  DEFAULT_LOW_STOCK_THRESHOLD,
  getInventorySummary,
} from '../inventory'
import {
  getLatestPrediction,
  getPredictionById,
} from '../predictions/service'
import type { PublicPrediction } from '../predictions/serialize'
import { computeShortageGap } from './gap'
import type {
  ListAlertsQuery,
  PatchAlertStatusBody,
  RecalculateAlertsBody,
} from './schemas'
import {
  toPublicAlert,
  type AlertRow,
  type BloodGroupJoinRow,
  type FacilityJoinRow,
  type PublicAlert,
} from './serialize'
import {
  ACTIVE_ALERT_STATUSES,
  assertAlertStatusTransition,
  shouldStampResolvedAt,
} from './status-machine'
import {
  loadShortageThresholdsFromEnv,
  type ShortageSeverityThresholds,
} from './thresholds'

type LoadedAlert = {
  alert: AlertRow
  bloodGroup: BloodGroupJoinRow | null
  facility: FacilityJoinRow | null
}

export type UpsertAlertResult = {
  alert: PublicAlert | null
  action: 'created' | 'updated' | 'resolved' | 'noop'
  gap: {
    predictedUnits: number
    availableUnits: number
    projectedGap: number
    severity: AlertSeverity | null
  }
}

export type UpsertFromPredictionInput = {
  predictionId: number
  bloodGroupId: number
  facilityId: number | null
  predictedUnits: number
}

export type AlertServiceDeps = {
  thresholds?: ShortageSeverityThresholds
  /**
   * Injectable inventory available lookup (tests).
   * Default: getInventorySummary → group availableUnits.
   */
  getAvailableUnits?: (
    db: Db,
    bloodGroupId: number,
    facilityId: number | null,
  ) => Promise<number>
}

function formatDecimal(value: number): string {
  return value.toFixed(2)
}

function mapAlertRow(row: typeof shortageAlerts.$inferSelect): AlertRow {
  return {
    id: row.id,
    bloodGroupId: row.bloodGroupId,
    facilityId: row.facilityId ?? null,
    predictionId: row.predictionId,
    availableUnits: row.availableUnits,
    predictedUnits: row.predictedUnits,
    projectedGap: row.projectedGap,
    severity: row.severity,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
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

function toPublicOrThrow(loaded: LoadedAlert | null): PublicAlert {
  const publicAlert = toPublicAlert(loaded?.alert, {
    bloodGroup: loaded?.bloodGroup,
    facility: loaded?.facility,
  })
  if (!publicAlert) {
    throw AppError.internal('Failed to serialize shortage alert')
  }
  return publicAlert
}

async function resolveBloodGroup(
  db: Db,
  bloodGroupId: number | undefined,
  bloodGroupCode: string | undefined,
): Promise<{ id: number; code: string }> {
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
    return { id: row.id, code: row.code }
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
    return { id: row.id, code: row.code }
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

async function defaultGetAvailableUnits(
  db: Db,
  bloodGroupId: number,
  facilityId: number | null,
): Promise<number> {
  const summary = await getInventorySummary(db, {
    facilityId: typeof facilityId === 'number' ? facilityId : undefined,
    expiringWithinDays: DEFAULT_EXPIRING_WITHIN_DAYS,
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
  })
  const group = (summary.groups ?? []).find(
    (g) => g?.bloodGroupId === bloodGroupId,
  )
  return typeof group?.availableUnits === 'number' ? group.availableUnits : 0
}

function facilityMatchSql(facilityId: number | null): SQL {
  if (typeof facilityId === 'number') {
    return eq(shortageAlerts.facilityId, facilityId)
  }
  return isNull(shortageAlerts.facilityId)
}

async function loadAlertById(
  db: Db,
  id: number,
): Promise<LoadedAlert | null> {
  const rows = await db
    .select({
      alert: shortageAlerts,
      bloodGroup: bloodGroups,
      facility: healthcareFacilities,
    })
    .from(shortageAlerts)
    .leftJoin(bloodGroups, eq(shortageAlerts.bloodGroupId, bloodGroups.id))
    .leftJoin(
      healthcareFacilities,
      eq(shortageAlerts.facilityId, healthcareFacilities.id),
    )
    .where(eq(shortageAlerts.id, id))
    .limit(1)

  const row = rows?.[0]
  if (!row?.alert?.id) {
    return null
  }

  return {
    alert: mapAlertRow(row.alert),
    bloodGroup: mapBloodGroupRow(row.bloodGroup),
    facility: mapFacilityRow(row.facility),
  }
}

async function findActiveAlert(
  db: Db,
  bloodGroupId: number,
  facilityId: number | null,
): Promise<LoadedAlert | null> {
  const rows = await db
    .select({
      alert: shortageAlerts,
      bloodGroup: bloodGroups,
      facility: healthcareFacilities,
    })
    .from(shortageAlerts)
    .leftJoin(bloodGroups, eq(shortageAlerts.bloodGroupId, bloodGroups.id))
    .leftJoin(
      healthcareFacilities,
      eq(shortageAlerts.facilityId, healthcareFacilities.id),
    )
    .where(
      and(
        eq(shortageAlerts.bloodGroupId, bloodGroupId),
        facilityMatchSql(facilityId),
        inArray(shortageAlerts.status, [...ACTIVE_ALERT_STATUSES]),
      ),
    )
    .orderBy(desc(shortageAlerts.createdAt), desc(shortageAlerts.id))
    .limit(1)

  const row = rows?.[0]
  if (!row?.alert?.id) {
    return null
  }

  return {
    alert: mapAlertRow(row.alert),
    bloodGroup: mapBloodGroupRow(row.bloodGroup),
    facility: mapFacilityRow(row.facility),
  }
}

export async function getAlertById(
  db: Db,
  id: number,
): Promise<PublicAlert> {
  const loaded = await loadAlertById(db, id)
  if (!loaded) {
    throw AppError.notFound('Shortage alert not found')
  }
  return toPublicOrThrow(loaded)
}

export type ListAlertsResult = {
  items: PublicAlert[]
  total: number
  limit: number
  offset: number
}

type AlertListFilters = {
  bloodGroupId?: number
  facilityId?: number
  status?: AlertStatus
  severity?: AlertSeverity
  activeOnly?: boolean
}

function buildAlertWhere(filters: AlertListFilters): SQL | undefined {
  const parts: SQL[] = []

  if (typeof filters.bloodGroupId === 'number') {
    parts.push(eq(shortageAlerts.bloodGroupId, filters.bloodGroupId))
  }
  if (typeof filters.facilityId === 'number') {
    parts.push(eq(shortageAlerts.facilityId, filters.facilityId))
  }
  if (filters.status) {
    parts.push(eq(shortageAlerts.status, filters.status))
  } else if (filters.activeOnly) {
    parts.push(inArray(shortageAlerts.status, [...ACTIVE_ALERT_STATUSES]))
  }
  if (filters.severity) {
    parts.push(eq(shortageAlerts.severity, filters.severity))
  }

  if (parts.length === 0) {
    return undefined
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return and(...parts)
}

export async function listAlerts(
  db: Db,
  query: ListAlertsQuery,
): Promise<ListAlertsResult> {
  const limit = query.limit ?? 50
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

  const whereClause = buildAlertWhere({
    bloodGroupId,
    facilityId: query.facilityId,
    status: query.status,
    severity: query.severity,
    activeOnly: query.activeOnly,
  })

  const [totalRow] = await db
    .select({ value: count() })
    .from(shortageAlerts)
    .where(whereClause)

  const total = Number(totalRow?.value ?? 0)

  const rows = await db
    .select({
      alert: shortageAlerts,
      bloodGroup: bloodGroups,
      facility: healthcareFacilities,
    })
    .from(shortageAlerts)
    .leftJoin(bloodGroups, eq(shortageAlerts.bloodGroupId, bloodGroups.id))
    .leftJoin(
      healthcareFacilities,
      eq(shortageAlerts.facilityId, healthcareFacilities.id),
    )
    .where(whereClause)
    .orderBy(desc(shortageAlerts.createdAt), desc(shortageAlerts.id))
    .limit(limit)
    .offset(offset)

  const items = (rows ?? [])
    .map((row) =>
      toPublicAlert(row?.alert ? mapAlertRow(row.alert) : null, {
        bloodGroup: mapBloodGroupRow(row?.bloodGroup),
        facility: mapFacilityRow(row?.facility),
      }),
    )
    .filter((item): item is PublicAlert => item !== null)

  return { items, total, limit, offset }
}

export type PatchAlertStatusResult = {
  alert: PublicAlert
  previousStatus: AlertStatus
}

export async function patchAlertStatus(
  db: Db,
  id: number,
  body: PatchAlertStatusBody,
): Promise<PatchAlertStatusResult> {
  const loaded = await loadAlertById(db, id)
  if (!loaded) {
    throw AppError.notFound('Shortage alert not found')
  }

  const previousStatus = loaded.alert.status
  const nextStatus = assertAlertStatusTransition(
    previousStatus,
    body.status,
  )

  const resolvedAt = shouldStampResolvedAt(nextStatus) ? new Date() : null

  await db
    .update(shortageAlerts)
    .set({
      status: nextStatus,
      resolvedAt,
    })
    .where(eq(shortageAlerts.id, id))

  const updated = await getAlertById(db, id)
  return { alert: updated, previousStatus }
}

/**
 * Create / refresh / auto-resolve the active alert for a blood group + facility
 * from predicted demand and current available inventory supply.
 */
export async function upsertAlertFromShortage(
  db: Db,
  input: UpsertFromPredictionInput,
  deps: AlertServiceDeps = {},
): Promise<UpsertAlertResult> {
  const thresholds = deps.thresholds ?? loadShortageThresholdsFromEnv()
  const getAvailable = deps.getAvailableUnits ?? defaultGetAvailableUnits

  const availableUnits = await getAvailable(
    db,
    input.bloodGroupId,
    input.facilityId,
  )
  const gap = computeShortageGap(
    {
      predictedDemand: input.predictedUnits,
      availableSupply: availableUnits,
    },
    thresholds,
  )

  const existing = await findActiveAlert(
    db,
    input.bloodGroupId,
    input.facilityId,
  )

  // No shortage — auto-resolve any active alert for this scope.
  if (gap.severity === null) {
    if (!existing) {
      return { alert: null, action: 'noop', gap }
    }

    await db
      .update(shortageAlerts)
      .set({
        status: 'RESOLVED',
        resolvedAt: new Date(),
        availableUnits: formatDecimal(gap.availableUnits),
        predictedUnits: formatDecimal(gap.predictedUnits),
        projectedGap: formatDecimal(gap.projectedGap),
        predictionId: input.predictionId,
      })
      .where(eq(shortageAlerts.id, existing.alert.id))

    const resolved = await getAlertById(db, existing.alert.id)
    return { alert: resolved, action: 'resolved', gap }
  }

  if (existing) {
    await db
      .update(shortageAlerts)
      .set({
        predictionId: input.predictionId,
        availableUnits: formatDecimal(gap.availableUnits),
        predictedUnits: formatDecimal(gap.predictedUnits),
        projectedGap: formatDecimal(gap.projectedGap),
        severity: gap.severity,
      })
      .where(eq(shortageAlerts.id, existing.alert.id))

    const updated = await getAlertById(db, existing.alert.id)
    return { alert: updated, action: 'updated', gap }
  }

  const inserted = await db
    .insert(shortageAlerts)
    .values({
      bloodGroupId: input.bloodGroupId,
      facilityId: input.facilityId,
      predictionId: input.predictionId,
      availableUnits: formatDecimal(gap.availableUnits),
      predictedUnits: formatDecimal(gap.predictedUnits),
      projectedGap: formatDecimal(gap.projectedGap),
      severity: gap.severity,
      status: 'OPEN',
    })
    .$returningId()

  const insertId = inserted?.[0]?.id
  if (typeof insertId !== 'number' || !Number.isFinite(insertId)) {
    throw AppError.internal('Failed to persist shortage alert')
  }

  const created = await getAlertById(db, insertId)
  return { alert: created, action: 'created', gap }
}

function predictionToUpsertInput(
  prediction: PublicPrediction,
): UpsertFromPredictionInput {
  return {
    predictionId: prediction.id,
    bloodGroupId: prediction.bloodGroupId,
    facilityId: prediction.facilityId ?? null,
    predictedUnits: prediction.predictedUnits ?? 0,
  }
}

export type RecalculateAlertsResult = {
  results: UpsertAlertResult[]
}

/**
 * Recalculate alerts from a specific prediction, latest for one blood group,
 * or latest prediction per blood group (when no filters).
 */
export async function recalculateAlerts(
  db: Db,
  body: RecalculateAlertsBody = {},
  deps: AlertServiceDeps = {},
): Promise<RecalculateAlertsResult> {
  if (typeof body.facilityId === 'number') {
    await assertFacilityExists(db, body.facilityId)
  }

  if (typeof body.predictionId === 'number') {
    const prediction = await getPredictionById(db, body.predictionId)
    const result = await upsertAlertFromShortage(
      db,
      predictionToUpsertInput(prediction),
      deps,
    )
    return { results: [result] }
  }

  if (
    body.bloodGroupId !== undefined ||
    body.bloodGroup !== undefined
  ) {
    const bloodGroup = await resolveBloodGroup(
      db,
      body.bloodGroupId,
      body.bloodGroup,
    )
    const prediction = await getLatestPrediction(db, {
      bloodGroupId: bloodGroup.id,
      facilityId:
        typeof body.facilityId === 'number' ? body.facilityId : undefined,
    })
    const result = await upsertAlertFromShortage(
      db,
      predictionToUpsertInput(prediction),
      deps,
    )
    return { results: [result] }
  }

  // All blood groups: use latest prediction per group (facility-scoped if set).
  const groups = await db
    .select({ id: bloodGroups.id })
    .from(bloodGroups)
    .orderBy(asc(bloodGroups.id))

  const results: UpsertAlertResult[] = []
  for (const group of groups ?? []) {
    if (typeof group?.id !== 'number') {
      continue
    }
    try {
      const prediction = await getLatestPrediction(db, {
        bloodGroupId: group.id,
        facilityId:
          typeof body.facilityId === 'number' ? body.facilityId : undefined,
      })
      const result = await upsertAlertFromShortage(
        db,
        predictionToUpsertInput(prediction),
        deps,
      )
      results.push(result)
    } catch (error) {
      // Skip groups with no prediction (404) — other failures propagate.
      if (error instanceof AppError && error.status === 404) {
        continue
      }
      throw error
    }
  }

  return { results }
}
