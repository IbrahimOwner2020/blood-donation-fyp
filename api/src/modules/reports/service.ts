/**
 * Report aggregation queries (docs/04 Reports, TODO.md §9).
 * Inventory reuses inventory summary rules (docs/08); other reports aggregate
 * from domain tables with optional date / blood-group filters.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lte,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm'

import type { Db } from '../../db'
import {
  aiPredictions,
  bloodGroups,
  demandRecords,
  donations,
  donors,
  notifications,
} from '../../db/schema'
import { AppError } from '../../lib/errors'
import {
  getInventorySummary,
  type InventorySummaryResult,
} from '../inventory/service'
import type {
  DemandReportQuery,
  DonationsReportQuery,
  InventoryReportQuery,
  NotificationsReportQuery,
  PredictionsReportQuery,
} from './schemas'
import {
  toDateOnlyString,
  toFiniteNumber,
  toPublicBloodGroup,
  type PublicBloodGroupSummary,
} from './serialize'

type Executor = Db

async function resolveBloodGroupId(
  db: Executor,
  bloodGroupId: number | undefined,
  bloodGroupCode: string | undefined,
): Promise<number | undefined> {
  if (typeof bloodGroupId === 'number') {
    const rows = await db
      .select({ id: bloodGroups.id })
      .from(bloodGroups)
      .where(eq(bloodGroups.id, bloodGroupId))
      .limit(1)
    if (!rows?.[0]?.id) {
      throw AppError.validation('Invalid blood group', [
        {
          path: 'bloodGroupId',
          message: 'Blood group does not exist',
          code: 'invalid_blood_group',
        },
      ])
    }
    return bloodGroupId
  }

  if (bloodGroupCode) {
    const rows = await db
      .select({ id: bloodGroups.id })
      .from(bloodGroups)
      .where(eq(bloodGroups.code, bloodGroupCode))
      .limit(1)
    const id = rows?.[0]?.id
    if (typeof id !== 'number') {
      throw AppError.validation('Invalid blood group', [
        {
          path: 'bloodGroup',
          message: 'Blood group does not exist',
          code: 'invalid_blood_group',
        },
      ])
    }
    return id
  }

  return undefined
}

function utcDayStart(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`)
}

function utcDayEnd(dateOnly: string): Date {
  return new Date(`${dateOnly}T23:59:59.999Z`)
}

export type InventoryReportGroup = {
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  availableUnits: number
  reservedUnits: number
  issuedUnits: number
  discardedUnits: number
  expiredUnits: number
  expiringSoonUnits: number
  lowStock: boolean
}

export type InventoryReportResult = {
  report: 'inventory'
  filters: {
    asOf: string
    bloodGroupId: number | null
    bloodGroup: string | null
    facilityId: number | null
  }
  asOf: string
  groups: InventoryReportGroup[]
  totals: InventorySummaryResult['totals']
}

export async function getInventoryReport(
  db: Db,
  query: InventoryReportQuery,
): Promise<InventoryReportResult> {
  const bloodGroupId = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )

  const summary = await getInventorySummary(db, {
    asOf: query.asOf,
    facilityId: query.facilityId,
  })

  const groupMetaRows = await db
    .select({
      id: bloodGroups.id,
      code: bloodGroups.code,
      abo: bloodGroups.abo,
      rh: bloodGroups.rh,
    })
    .from(bloodGroups)
  const groupMeta = new Map(
    (groupMetaRows ?? []).map((row) => [
      row.id,
      toPublicBloodGroup({
        id: row.id,
        code: row.code,
        abo: row.abo,
        rh: row.rh,
      }),
    ]),
  )

  let groups = summary.groups.map((g) => ({
    bloodGroupId: g.bloodGroupId,
    bloodGroup:
      groupMeta.get(g.bloodGroupId) ??
      (g.bloodGroupCode
        ? {
            id: g.bloodGroupId,
            code: g.bloodGroupCode,
            abo: '',
            rh: '',
          }
        : null),
    availableUnits: g.availableUnits,
    reservedUnits: g.reservedUnits,
    issuedUnits: g.issuedUnits,
    discardedUnits: g.discardedUnits,
    expiredUnits: g.expiredUnits,
    expiringSoonUnits: g.expiringSoonUnits,
    lowStock: g.lowStock,
  }))

  if (typeof bloodGroupId === 'number') {
    groups = groups.filter((g) => g.bloodGroupId === bloodGroupId)
  }

  const totals = {
    availableUnits: 0,
    reservedUnits: 0,
    issuedUnits: 0,
    discardedUnits: 0,
    expiredUnits: 0,
    expiringSoonUnits: 0,
    lowStockGroupCount: 0,
  }
  for (const g of groups) {
    totals.availableUnits += g.availableUnits
    totals.reservedUnits += g.reservedUnits
    totals.issuedUnits += g.issuedUnits
    totals.discardedUnits += g.discardedUnits
    totals.expiredUnits += g.expiredUnits
    totals.expiringSoonUnits += g.expiringSoonUnits
    if (g.lowStock) {
      totals.lowStockGroupCount += 1
    }
  }

  return {
    report: 'inventory',
    filters: {
      asOf: summary.asOf,
      bloodGroupId: bloodGroupId ?? null,
      bloodGroup: query.bloodGroup ?? null,
      facilityId: query.facilityId ?? null,
    },
    asOf: summary.asOf,
    groups,
    totals,
  }
}

export type DonationsByBloodGroupRow = {
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  donationCount: number
  units: number
}

export type DonationsByDateRow = {
  date: string
  donationCount: number
  units: number
}

export type DonationsReportResult = {
  report: 'donations'
  filters: {
    from: string | null
    to: string | null
    bloodGroupId: number | null
    bloodGroup: string | null
  }
  totals: {
    donationCount: number
    units: number
  }
  byBloodGroup: DonationsByBloodGroupRow[]
  byDate: DonationsByDateRow[]
}

export async function getDonationsReport(
  db: Db,
  query: DonationsReportQuery,
): Promise<DonationsReportResult> {
  const bloodGroupId = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )

  const parts: SQL[] = []
  if (query.from) {
    parts.push(gte(donations.donationDate, query.from))
  }
  if (query.to) {
    parts.push(lte(donations.donationDate, query.to))
  }
  if (typeof bloodGroupId === 'number') {
    parts.push(eq(donations.bloodGroupId, bloodGroupId))
  }
  const where = parts.length > 0 ? and(...parts) : undefined

  const [totalRow] = await db
    .select({
      donationCount: count(),
      units: sum(donations.units),
    })
    .from(donations)
    .where(where)

  const byGroupRows = await db
    .select({
      bloodGroupId: donations.bloodGroupId,
      code: bloodGroups.code,
      abo: bloodGroups.abo,
      rh: bloodGroups.rh,
      donationCount: count(),
      units: sum(donations.units),
    })
    .from(donations)
    .innerJoin(bloodGroups, eq(donations.bloodGroupId, bloodGroups.id))
    .where(where)
    .groupBy(
      donations.bloodGroupId,
      bloodGroups.code,
      bloodGroups.abo,
      bloodGroups.rh,
    )
    .orderBy(asc(bloodGroups.code))

  const byDateRows = await db
    .select({
      date: donations.donationDate,
      donationCount: count(),
      units: sum(donations.units),
    })
    .from(donations)
    .where(where)
    .groupBy(donations.donationDate)
    .orderBy(asc(donations.donationDate))

  return {
    report: 'donations',
    filters: {
      from: query.from ?? null,
      to: query.to ?? null,
      bloodGroupId: bloodGroupId ?? null,
      bloodGroup: query.bloodGroup ?? null,
    },
    totals: {
      donationCount: toFiniteNumber(totalRow?.donationCount),
      units: toFiniteNumber(totalRow?.units),
    },
    byBloodGroup: (byGroupRows ?? []).map((row) => ({
      bloodGroupId: row.bloodGroupId,
      bloodGroup: toPublicBloodGroup({
        id: row.bloodGroupId,
        code: row.code,
        abo: row.abo,
        rh: row.rh,
      }),
      donationCount: toFiniteNumber(row.donationCount),
      units: toFiniteNumber(row.units),
    })),
    byDate: (byDateRows ?? []).map((row) => ({
      date: toDateOnlyString(row.date),
      donationCount: toFiniteNumber(row.donationCount),
      units: toFiniteNumber(row.units),
    })),
  }
}

export type DemandByBloodGroupRow = {
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  unitsRequested: number
  unitsIssued: number
  unitsUsed: number
  unfulfilledUnits: number
}

export type DemandByDateRow = {
  date: string
  unitsRequested: number
  unitsIssued: number
  unitsUsed: number
  unfulfilledUnits: number
}

export type DemandReportResult = {
  report: 'demand'
  filters: {
    from: string | null
    to: string | null
    bloodGroupId: number | null
    bloodGroup: string | null
  }
  totals: {
    unitsRequested: number
    unitsIssued: number
    unitsUsed: number
    unfulfilledUnits: number
    recordCount: number
  }
  byBloodGroup: DemandByBloodGroupRow[]
  byDate: DemandByDateRow[]
}

export async function getDemandReport(
  db: Db,
  query: DemandReportQuery,
): Promise<DemandReportResult> {
  const bloodGroupId = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )

  const parts: SQL[] = []
  if (query.from) {
    parts.push(gte(demandRecords.date, query.from))
  }
  if (query.to) {
    parts.push(lte(demandRecords.date, query.to))
  }
  if (typeof bloodGroupId === 'number') {
    parts.push(eq(demandRecords.bloodGroupId, bloodGroupId))
  }
  const where = parts.length > 0 ? and(...parts) : undefined

  const [totalRow] = await db
    .select({
      recordCount: count(),
      unitsRequested: sum(demandRecords.unitsRequested),
      unitsIssued: sum(demandRecords.unitsIssued),
      unitsUsed: sum(demandRecords.unitsUsed),
      unfulfilledUnits: sum(demandRecords.unfulfilledUnits),
    })
    .from(demandRecords)
    .where(where)

  const byGroupRows = await db
    .select({
      bloodGroupId: demandRecords.bloodGroupId,
      code: bloodGroups.code,
      abo: bloodGroups.abo,
      rh: bloodGroups.rh,
      unitsRequested: sum(demandRecords.unitsRequested),
      unitsIssued: sum(demandRecords.unitsIssued),
      unitsUsed: sum(demandRecords.unitsUsed),
      unfulfilledUnits: sum(demandRecords.unfulfilledUnits),
    })
    .from(demandRecords)
    .innerJoin(bloodGroups, eq(demandRecords.bloodGroupId, bloodGroups.id))
    .where(where)
    .groupBy(
      demandRecords.bloodGroupId,
      bloodGroups.code,
      bloodGroups.abo,
      bloodGroups.rh,
    )
    .orderBy(asc(bloodGroups.code))

  const byDateRows = await db
    .select({
      date: demandRecords.date,
      unitsRequested: sum(demandRecords.unitsRequested),
      unitsIssued: sum(demandRecords.unitsIssued),
      unitsUsed: sum(demandRecords.unitsUsed),
      unfulfilledUnits: sum(demandRecords.unfulfilledUnits),
    })
    .from(demandRecords)
    .where(where)
    .groupBy(demandRecords.date)
    .orderBy(asc(demandRecords.date))

  return {
    report: 'demand',
    filters: {
      from: query.from ?? null,
      to: query.to ?? null,
      bloodGroupId: bloodGroupId ?? null,
      bloodGroup: query.bloodGroup ?? null,
    },
    totals: {
      recordCount: toFiniteNumber(totalRow?.recordCount),
      unitsRequested: toFiniteNumber(totalRow?.unitsRequested),
      unitsIssued: toFiniteNumber(totalRow?.unitsIssued),
      unitsUsed: toFiniteNumber(totalRow?.unitsUsed),
      unfulfilledUnits: toFiniteNumber(totalRow?.unfulfilledUnits),
    },
    byBloodGroup: (byGroupRows ?? []).map((row) => ({
      bloodGroupId: row.bloodGroupId,
      bloodGroup: toPublicBloodGroup({
        id: row.bloodGroupId,
        code: row.code,
        abo: row.abo,
        rh: row.rh,
      }),
      unitsRequested: toFiniteNumber(row.unitsRequested),
      unitsIssued: toFiniteNumber(row.unitsIssued),
      unitsUsed: toFiniteNumber(row.unitsUsed),
      unfulfilledUnits: toFiniteNumber(row.unfulfilledUnits),
    })),
    byDate: (byDateRows ?? []).map((row) => ({
      date: toDateOnlyString(row.date),
      unitsRequested: toFiniteNumber(row.unitsRequested),
      unitsIssued: toFiniteNumber(row.unitsIssued),
      unitsUsed: toFiniteNumber(row.unitsUsed),
      unfulfilledUnits: toFiniteNumber(row.unfulfilledUnits),
    })),
  }
}

export type PredictionsByBloodGroupRow = {
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  runCount: number
  predictedUnits: number
}

export type PredictionSummaryRow = {
  id: number
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  facilityId: number | null
  forecastStart: string
  forecastEnd: string
  predictedUnits: number
  modelName: string
  modelVersion: string | null
  createdAt: string
}

export type PredictionsReportResult = {
  report: 'predictions'
  filters: {
    from: string | null
    to: string | null
    bloodGroupId: number | null
    bloodGroup: string | null
  }
  totals: {
    runCount: number
    predictedUnits: number
  }
  byBloodGroup: PredictionsByBloodGroupRow[]
  recent: PredictionSummaryRow[]
}

export async function getPredictionsReport(
  db: Db,
  query: PredictionsReportQuery,
): Promise<PredictionsReportResult> {
  const bloodGroupId = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )

  const parts: SQL[] = []
  if (query.from) {
    parts.push(gte(aiPredictions.forecastStart, query.from))
  }
  if (query.to) {
    parts.push(lte(aiPredictions.forecastStart, query.to))
  }
  if (typeof bloodGroupId === 'number') {
    parts.push(eq(aiPredictions.bloodGroupId, bloodGroupId))
  }
  const where = parts.length > 0 ? and(...parts) : undefined

  const [totalRow] = await db
    .select({
      runCount: count(),
      predictedUnits: sum(aiPredictions.predictedUnits),
    })
    .from(aiPredictions)
    .where(where)

  const byGroupRows = await db
    .select({
      bloodGroupId: aiPredictions.bloodGroupId,
      code: bloodGroups.code,
      abo: bloodGroups.abo,
      rh: bloodGroups.rh,
      runCount: count(),
      predictedUnits: sum(aiPredictions.predictedUnits),
    })
    .from(aiPredictions)
    .innerJoin(bloodGroups, eq(aiPredictions.bloodGroupId, bloodGroups.id))
    .where(where)
    .groupBy(
      aiPredictions.bloodGroupId,
      bloodGroups.code,
      bloodGroups.abo,
      bloodGroups.rh,
    )
    .orderBy(asc(bloodGroups.code))

  const recentRows = await db
    .select({
      id: aiPredictions.id,
      bloodGroupId: aiPredictions.bloodGroupId,
      code: bloodGroups.code,
      abo: bloodGroups.abo,
      rh: bloodGroups.rh,
      facilityId: aiPredictions.facilityId,
      forecastStart: aiPredictions.forecastStart,
      forecastEnd: aiPredictions.forecastEnd,
      predictedUnits: aiPredictions.predictedUnits,
      modelName: aiPredictions.modelName,
      modelVersion: aiPredictions.modelVersion,
      createdAt: aiPredictions.createdAt,
    })
    .from(aiPredictions)
    .innerJoin(bloodGroups, eq(aiPredictions.bloodGroupId, bloodGroups.id))
    .where(where)
    .orderBy(desc(aiPredictions.createdAt), desc(aiPredictions.id))
    .limit(25)

  return {
    report: 'predictions',
    filters: {
      from: query.from ?? null,
      to: query.to ?? null,
      bloodGroupId: bloodGroupId ?? null,
      bloodGroup: query.bloodGroup ?? null,
    },
    totals: {
      runCount: toFiniteNumber(totalRow?.runCount),
      predictedUnits: toFiniteNumber(totalRow?.predictedUnits),
    },
    byBloodGroup: (byGroupRows ?? []).map((row) => ({
      bloodGroupId: row.bloodGroupId,
      bloodGroup: toPublicBloodGroup({
        id: row.bloodGroupId,
        code: row.code,
        abo: row.abo,
        rh: row.rh,
      }),
      runCount: toFiniteNumber(row.runCount),
      predictedUnits: toFiniteNumber(row.predictedUnits),
    })),
    recent: (recentRows ?? []).map((row) => ({
      id: row.id,
      bloodGroupId: row.bloodGroupId,
      bloodGroup: toPublicBloodGroup({
        id: row.bloodGroupId,
        code: row.code,
        abo: row.abo,
        rh: row.rh,
      }),
      facilityId: row.facilityId ?? null,
      forecastStart: toDateOnlyString(row.forecastStart),
      forecastEnd: toDateOnlyString(row.forecastEnd),
      predictedUnits: toFiniteNumber(row.predictedUnits),
      modelName: row.modelName ?? '',
      modelVersion: row.modelVersion ?? null,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt ?? ''),
    })),
  }
}

export type NotificationsByStatusRow = {
  status: string
  count: number
}

export type NotificationsByChannelRow = {
  channel: string
  count: number
}

export type NotificationsByBloodGroupRow = {
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  count: number
}

export type NotificationsByDateRow = {
  date: string
  count: number
}

export type NotificationsReportResult = {
  report: 'notifications'
  filters: {
    from: string | null
    to: string | null
    bloodGroupId: number | null
    bloodGroup: string | null
    channel: string | null
    status: string | null
  }
  totals: {
    total: number
  }
  byStatus: NotificationsByStatusRow[]
  byChannel: NotificationsByChannelRow[]
  byBloodGroup: NotificationsByBloodGroupRow[]
  byDate: NotificationsByDateRow[]
}

export async function getNotificationsReport(
  db: Db,
  query: NotificationsReportQuery,
): Promise<NotificationsReportResult> {
  const bloodGroupId = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )

  const parts: SQL[] = []
  if (query.from) {
    parts.push(gte(notifications.createdAt, utcDayStart(query.from)))
  }
  if (query.to) {
    parts.push(lte(notifications.createdAt, utcDayEnd(query.to)))
  }
  if (query.channel) {
    parts.push(eq(notifications.channel, query.channel))
  }
  if (query.status) {
    parts.push(eq(notifications.status, query.status))
  }
  if (typeof bloodGroupId === 'number') {
    parts.push(eq(donors.bloodGroupId, bloodGroupId))
  }
  const where = parts.length > 0 ? and(...parts) : undefined

  const baseFrom = () =>
    db
      .select({ value: count() })
      .from(notifications)
      .innerJoin(donors, eq(notifications.donorId, donors.id))
      .where(where)

  const [totalRow] = await baseFrom()

  const byStatusRows = await db
    .select({
      status: notifications.status,
      count: count(),
    })
    .from(notifications)
    .innerJoin(donors, eq(notifications.donorId, donors.id))
    .where(where)
    .groupBy(notifications.status)
    .orderBy(asc(notifications.status))

  const byChannelRows = await db
    .select({
      channel: notifications.channel,
      count: count(),
    })
    .from(notifications)
    .innerJoin(donors, eq(notifications.donorId, donors.id))
    .where(where)
    .groupBy(notifications.channel)
    .orderBy(asc(notifications.channel))

  const byGroupRows = await db
    .select({
      bloodGroupId: donors.bloodGroupId,
      code: bloodGroups.code,
      abo: bloodGroups.abo,
      rh: bloodGroups.rh,
      count: count(),
    })
    .from(notifications)
    .innerJoin(donors, eq(notifications.donorId, donors.id))
    .innerJoin(bloodGroups, eq(donors.bloodGroupId, bloodGroups.id))
    .where(where)
    .groupBy(
      donors.bloodGroupId,
      bloodGroups.code,
      bloodGroups.abo,
      bloodGroups.rh,
    )
    .orderBy(asc(bloodGroups.code))

  const byDateRows = await db
    .select({
      date: sql<string>`DATE(${notifications.createdAt})`.as('date'),
      count: count(),
    })
    .from(notifications)
    .innerJoin(donors, eq(notifications.donorId, donors.id))
    .where(where)
    .groupBy(sql`DATE(${notifications.createdAt})`)
    .orderBy(asc(sql`DATE(${notifications.createdAt})`))

  return {
    report: 'notifications',
    filters: {
      from: query.from ?? null,
      to: query.to ?? null,
      bloodGroupId: bloodGroupId ?? null,
      bloodGroup: query.bloodGroup ?? null,
      channel: query.channel ?? null,
      status: query.status ?? null,
    },
    totals: {
      total: toFiniteNumber(totalRow?.value),
    },
    byStatus: (byStatusRows ?? []).map((row) => ({
      status: row.status ?? '',
      count: toFiniteNumber(row.count),
    })),
    byChannel: (byChannelRows ?? []).map((row) => ({
      channel: row.channel ?? '',
      count: toFiniteNumber(row.count),
    })),
    byBloodGroup: (byGroupRows ?? []).map((row) => ({
      bloodGroupId: row.bloodGroupId,
      bloodGroup: toPublicBloodGroup({
        id: row.bloodGroupId,
        code: row.code,
        abo: row.abo,
        rh: row.rh,
      }),
      count: toFiniteNumber(row.count),
    })),
    byDate: (byDateRows ?? []).map((row) => ({
      date: toDateOnlyString(row.date),
      count: toFiniteNumber(row.count),
    })),
  }
}
