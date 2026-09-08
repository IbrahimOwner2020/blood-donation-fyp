/**
 * Dashboard persistence / aggregation (docs/04 Dashboard, TODO.md §9).
 * Server computes KPIs and trends — clients must not invent business totals.
 *
 * Permission gate is applied at the route layer (`reports:read`).
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm'

import type { Db } from '../../db'
import {
  aiPredictions,
  bloodGroups,
  bloodInventory,
  demandRecords,
  donations,
  healthcareFacilities,
  notifications,
  shortageAlerts,
} from '../../db/schema'
import { AppError } from '../../lib/errors'
import { listAlerts } from '../alerts/service'
import { ACTIVE_ALERT_STATUSES } from '../alerts/status-machine'
import type { PublicAlert } from '../alerts/serialize'
import { DEFAULT_EXPIRING_WITHIN_DAYS } from '../inventory/constants'
import { getInventorySummary } from '../inventory/service'
import type { BloodGroupInventoryCounts } from '../inventory/availability'
import {
  toPublicPrediction,
  type PublicPrediction,
  type PredictionRow,
  type BloodGroupJoinRow,
  type FacilityJoinRow,
} from '../predictions/serialize'
import {
  bucketTrendByDate,
  fillTrendRange,
  resolvePeriod,
  sumTrendUnits,
  toDateOnlyString,
  type DateOnlyPeriod,
  type TrendPoint,
} from './aggregate'
import type {
  DashboardAlertsQuery,
  DashboardPredictionsQuery,
  DashboardSummaryQuery,
  DashboardTrendQuery,
} from './schemas'

export type DashboardKpis = {
  availableUnits: number
  lowStockGroupCount: number
  activeAlerts: number
  donationsThisPeriod: number
  donationUnitsThisPeriod: number
  notificationsSentThisPeriod: number
}

export type DashboardSummaryResult = {
  period: DateOnlyPeriod
  asOf: string
  lowStockThreshold: number
  facilityId: number | null
  kpis: DashboardKpis
  inventoryByBloodGroup: BloodGroupInventoryCounts[]
}

export type DashboardTrendResult = {
  period: DateOnlyPeriod
  facilityId: number | null
  bloodGroupId: number | null
  bloodGroupCode: string | null
  points: TrendPoint[]
  totalUnits: number
}

export type DashboardPredictionsResult = {
  facilityId: number | null
  predictions: PublicPrediction[]
}

export type DashboardAlertsResult = {
  alerts: PublicAlert[]
  total: number
  limit: number
  activeOnly: boolean
}

async function resolveBloodGroupId(
  db: Db,
  bloodGroupId: number | undefined,
  bloodGroupCode: string | undefined,
): Promise<{ id: number; code: string } | null> {
  if (bloodGroupId === undefined && bloodGroupCode === undefined) {
    return null
  }

  if (typeof bloodGroupId === 'number') {
    const rows = await db
      .select({ id: bloodGroups.id, code: bloodGroups.code })
      .from(bloodGroups)
      .where(eq(bloodGroups.id, bloodGroupId))
      .limit(1)
    const row = rows?.[0]
    if (!row?.id) {
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

  const rows = await db
    .select({ id: bloodGroups.id, code: bloodGroups.code })
    .from(bloodGroups)
    .where(eq(bloodGroups.code, bloodGroupCode ?? ''))
    .limit(1)
  const row = rows?.[0]
  if (!row?.id) {
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

async function assertFacilityExists(
  db: Db,
  facilityId: number | undefined,
): Promise<number | null> {
  if (typeof facilityId !== 'number') {
    return null
  }
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
  return facilityId
}

function periodFromQuery(query: {
  from?: string
  to?: string
  days?: number
}): DateOnlyPeriod {
  return resolvePeriod({
    from: query.from,
    to: query.to,
    defaultDays: query.days,
  })
}

/**
 * GET /dashboard/summary — KPI cards + inventory distribution snapshot.
 */
export async function getDashboardSummary(
  db: Db,
  query: DashboardSummaryQuery,
): Promise<DashboardSummaryResult> {
  const period = periodFromQuery(query)
  const facilityId = await assertFacilityExists(db, query.facilityId)
  const asOf = query.asOf ?? period.to
  const lowStockThreshold = query.lowStockThreshold

  const inventory = await getInventorySummary(db, {
    asOf,
    facilityId: facilityId ?? undefined,
    lowStockThreshold,
    expiringWithinDays: DEFAULT_EXPIRING_WITHIN_DAYS,
  })

  const alertParts: SQL[] = [
    inArray(shortageAlerts.status, [...ACTIVE_ALERT_STATUSES]),
  ]
  if (facilityId != null) {
    alertParts.push(eq(shortageAlerts.facilityId, facilityId))
  }
  const [activeAlertRow] = await db
    .select({ value: count() })
    .from(shortageAlerts)
    .where(and(...alertParts))

  const donationParts: SQL[] = [
    gte(donations.donationDate, period.from),
    lte(donations.donationDate, period.to),
  ]
  const [donationCountRow] = await db
    .select({
      donations: count(),
      units: sql<number>`coalesce(sum(${donations.units}), 0)`,
    })
    .from(donations)
    .where(and(...donationParts))

  const notificationParts: SQL[] = [
    eq(notifications.status, 'SENT'),
    gte(notifications.createdAt, new Date(`${period.from}T00:00:00.000Z`)),
    lte(notifications.createdAt, new Date(`${period.to}T23:59:59.999Z`)),
  ]
  const [notificationRow] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(...notificationParts))

  return {
    period,
    asOf: inventory.asOf,
    lowStockThreshold: inventory.lowStockThreshold,
    facilityId,
    kpis: {
      availableUnits: inventory.totals?.availableUnits ?? 0,
      lowStockGroupCount: inventory.totals?.lowStockGroupCount ?? 0,
      activeAlerts: Number(activeAlertRow?.value ?? 0),
      donationsThisPeriod: Number(donationCountRow?.donations ?? 0),
      donationUnitsThisPeriod: Number(donationCountRow?.units ?? 0),
      notificationsSentThisPeriod: Number(notificationRow?.value ?? 0),
    },
    inventoryByBloodGroup: inventory.groups ?? [],
  }
}

/**
 * Inventory acquisition trend: units collected per day (collection_date).
 * Without historical inventory snapshots this is the practical time series.
 */
export async function getInventoryTrend(
  db: Db,
  query: DashboardTrendQuery,
): Promise<DashboardTrendResult> {
  const period = periodFromQuery(query)
  const facilityId = await assertFacilityExists(db, query.facilityId)
  const group = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )

  const parts: SQL[] = [
    gte(bloodInventory.collectionDate, period.from),
    lte(bloodInventory.collectionDate, period.to),
  ]
  if (facilityId != null) {
    parts.push(eq(bloodInventory.facilityId, facilityId))
  }
  if (group) {
    parts.push(eq(bloodInventory.bloodGroupId, group.id))
  }

  const rows = await db
    .select({
      date: bloodInventory.collectionDate,
      units: count(),
    })
    .from(bloodInventory)
    .where(and(...parts))
    .groupBy(bloodInventory.collectionDate)
    .orderBy(asc(bloodInventory.collectionDate))

  const bucketed = bucketTrendByDate(
    (rows ?? []).map((row) => ({
      date: toDateOnlyString(row?.date),
      units: Number(row?.units ?? 0),
    })),
  )
  const points = fillTrendRange(period.from, period.to, bucketed)

  return {
    period,
    facilityId,
    bloodGroupId: group?.id ?? null,
    bloodGroupCode: group?.code ?? null,
    points,
    totalUnits: sumTrendUnits(points),
  }
}

/**
 * Donation trend: donated units per donation_date.
 */
export async function getDonationTrend(
  db: Db,
  query: DashboardTrendQuery,
): Promise<DashboardTrendResult> {
  const period = periodFromQuery(query)
  const group = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )

  const parts: SQL[] = [
    gte(donations.donationDate, period.from),
    lte(donations.donationDate, period.to),
  ]
  if (group) {
    parts.push(eq(donations.bloodGroupId, group.id))
  }
  if (typeof query.donationCentreId === 'number') {
    parts.push(eq(donations.donationCentreId, query.donationCentreId))
  }

  const rows = await db
    .select({
      date: donations.donationDate,
      units: sql<number>`coalesce(sum(${donations.units}), 0)`,
    })
    .from(donations)
    .where(and(...parts))
    .groupBy(donations.donationDate)
    .orderBy(asc(donations.donationDate))

  const bucketed = bucketTrendByDate(
    (rows ?? []).map((row) => ({
      date: toDateOnlyString(row?.date),
      units: Number(row?.units ?? 0),
    })),
  )
  const points = fillTrendRange(period.from, period.to, bucketed)

  return {
    period,
    facilityId: null,
    bloodGroupId: group?.id ?? null,
    bloodGroupCode: group?.code ?? null,
    points,
    totalUnits: sumTrendUnits(points),
  }
}

/**
 * Demand / usage trend from demand_records (units requested per day).
 */
export async function getDemandTrend(
  db: Db,
  query: DashboardTrendQuery,
): Promise<DashboardTrendResult> {
  const period = periodFromQuery(query)
  const facilityId = await assertFacilityExists(db, query.facilityId)
  const group = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )

  const parts: SQL[] = [
    gte(demandRecords.date, period.from),
    lte(demandRecords.date, period.to),
  ]
  if (facilityId != null) {
    parts.push(eq(demandRecords.facilityId, facilityId))
  }
  if (group) {
    parts.push(eq(demandRecords.bloodGroupId, group.id))
  }

  const rows = await db
    .select({
      date: demandRecords.date,
      units: sql<number>`coalesce(sum(${demandRecords.unitsRequested}), 0)`,
    })
    .from(demandRecords)
    .where(and(...parts))
    .groupBy(demandRecords.date)
    .orderBy(asc(demandRecords.date))

  const bucketed = bucketTrendByDate(
    (rows ?? []).map((row) => ({
      date: toDateOnlyString(row?.date),
      units: Number(row?.units ?? 0),
    })),
  )
  const points = fillTrendRange(period.from, period.to, bucketed)

  return {
    period,
    facilityId,
    bloodGroupId: group?.id ?? null,
    bloodGroupCode: group?.code ?? null,
    points,
    totalUnits: sumTrendUnits(points),
  }
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
    metricsJson: row.metricsJson ?? null,
    createdAt: row.createdAt,
  }
}

function mapBloodGroupJoin(
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

function mapFacilityJoin(
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

/**
 * Latest prediction snapshot per blood group (optionally facility-scoped).
 * Includes daily series for supply-vs-demand charts.
 */
export async function getDashboardPredictions(
  db: Db,
  query: DashboardPredictionsQuery,
): Promise<DashboardPredictionsResult> {
  const facilityId = await assertFacilityExists(db, query.facilityId)
  const group = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )
  const limit = query.limit ?? 16

  const parts: SQL[] = []
  if (facilityId != null) {
    parts.push(eq(aiPredictions.facilityId, facilityId))
  }
  if (group) {
    parts.push(eq(aiPredictions.bloodGroupId, group.id))
  }
  const whereClause =
    parts.length === 0
      ? undefined
      : parts.length === 1
        ? parts[0]
        : and(...parts)

  /** Fetch a generous window then keep latest per blood group in memory. */
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
    .limit(Math.max(limit * 8, 64))

  const latestByGroup = new Map<number, PublicPrediction>()
  for (const row of rows ?? []) {
    const prediction = row?.prediction
    if (!prediction?.id || !prediction.bloodGroupId) {
      continue
    }
    if (latestByGroup.has(prediction.bloodGroupId)) {
      continue
    }
    const publicRow = toPublicPrediction(mapPredictionRow(prediction), {
      bloodGroup: mapBloodGroupJoin(row?.bloodGroup),
      facility: mapFacilityJoin(row?.facility),
    })
    if (publicRow) {
      latestByGroup.set(prediction.bloodGroupId, publicRow)
    }
    if (latestByGroup.size >= limit) {
      break
    }
  }

  const predictions = [...latestByGroup.values()].sort((a, b) => {
    const codeA = a.bloodGroup?.code ?? ''
    const codeB = b.bloodGroup?.code ?? ''
    return codeA < codeB ? -1 : codeA > codeB ? 1 : a.id - b.id
  })

  return {
    facilityId,
    predictions,
  }
}

/**
 * Recent shortage alerts for the dashboard alert table.
 */
export async function getDashboardAlerts(
  db: Db,
  query: DashboardAlertsQuery,
): Promise<DashboardAlertsResult> {
  const activeOnly = query.activeOnly ?? true
  const limit = query.limit ?? 10

  const result = await listAlerts(db, {
    facilityId: query.facilityId,
    bloodGroupId: query.bloodGroupId,
    bloodGroup: query.bloodGroup,
    activeOnly: activeOnly || undefined,
    limit,
    offset: 0,
  })

  return {
    alerts: result.items ?? [],
    total: result.total ?? 0,
    limit: result.limit ?? limit,
    activeOnly,
  }
}
