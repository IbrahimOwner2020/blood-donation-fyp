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
  max,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm'

import type { Db } from '../../db'
import {
  bloodGroups,
  bloodRequests,
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
  BloodRequestsReportQuery,
  DonorEligibilityReportQuery,
  DonationsReportQuery,
  InventoryReportQuery,
  NotificationsReportQuery,
} from './schemas'
import {
  toDateOnlyString,
  toFiniteNumber,
  toPublicBloodGroup,
  type PublicBloodGroupSummary,
} from './serialize'
import { calculateDonorEligibility } from '../donors/eligibility'

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

export type BloodRequestsByBloodGroupRow = {
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  unitsRequested: number
  fulfilledUnits: number
  unfulfilledUnits: number
  requestCount: number
}

export type BloodRequestsByDateRow = {
  date: string
  unitsRequested: number
  fulfilledUnits: number
  unfulfilledUnits: number
}

export type BloodRequestsReportResult = {
  report: 'blood-requests'
  filters: {
    from: string | null
    to: string | null
    bloodGroupId: number | null
    bloodGroup: string | null
    facilityId: number | null
  }
  totals: {
    unitsRequested: number
    fulfilledUnits: number
    unfulfilledUnits: number
    requestCount: number
  }
  byBloodGroup: BloodRequestsByBloodGroupRow[]
  byDate: BloodRequestsByDateRow[]
}

export async function getBloodRequestsReport(
  db: Db,
  query: BloodRequestsReportQuery,
): Promise<BloodRequestsReportResult> {
  const bloodGroupId = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )

  const parts: SQL[] = []
  if (query.from) {
    parts.push(gte(bloodRequests.requestedAt, utcDayStart(query.from)))
  }
  if (query.to) {
    parts.push(lte(bloodRequests.requestedAt, utcDayEnd(query.to)))
  }
  if (typeof bloodGroupId === 'number') {
    parts.push(eq(bloodRequests.bloodGroupId, bloodGroupId))
  }
  if (typeof query.facilityId === 'number') {
    parts.push(eq(bloodRequests.facilityId, query.facilityId))
  }
  const where = parts.length > 0 ? and(...parts) : undefined

  const [totalRow] = await db
    .select({
      requestCount: count(),
      unitsRequested: sum(bloodRequests.unitsRequested),
      fulfilledUnits: sum(bloodRequests.fulfilledUnits),
      unfulfilledUnits: sum(sql`GREATEST(${bloodRequests.unitsRequested} - ${bloodRequests.fulfilledUnits}, 0)`),
    })
    .from(bloodRequests)
    .where(where)

  const byGroupRows = await db
    .select({
      bloodGroupId: bloodRequests.bloodGroupId,
      code: bloodGroups.code,
      abo: bloodGroups.abo,
      rh: bloodGroups.rh,
      requestCount: count(),
      unitsRequested: sum(bloodRequests.unitsRequested),
      fulfilledUnits: sum(bloodRequests.fulfilledUnits),
      unfulfilledUnits: sum(sql`GREATEST(${bloodRequests.unitsRequested} - ${bloodRequests.fulfilledUnits}, 0)`),
    })
    .from(bloodRequests)
    .innerJoin(bloodGroups, eq(bloodRequests.bloodGroupId, bloodGroups.id))
    .where(where)
    .groupBy(
      bloodRequests.bloodGroupId,
      bloodGroups.code,
      bloodGroups.abo,
      bloodGroups.rh,
    )
    .orderBy(asc(bloodGroups.code))

  const byDateRows = await db
    .select({
      date: sql<string>`DATE(${bloodRequests.requestedAt})`.as('date'),
      unitsRequested: sum(bloodRequests.unitsRequested),
      fulfilledUnits: sum(bloodRequests.fulfilledUnits),
      unfulfilledUnits: sum(sql`GREATEST(${bloodRequests.unitsRequested} - ${bloodRequests.fulfilledUnits}, 0)`),
    })
    .from(bloodRequests)
    .where(where)
    .groupBy(sql`DATE(${bloodRequests.requestedAt})`)
    .orderBy(asc(sql`DATE(${bloodRequests.requestedAt})`))

  return {
    report: 'blood-requests',
    filters: {
      from: query.from ?? null,
      to: query.to ?? null,
      bloodGroupId: bloodGroupId ?? null,
      bloodGroup: query.bloodGroup ?? null,
      facilityId: query.facilityId ?? null,
    },
    totals: {
      requestCount: toFiniteNumber(totalRow?.requestCount),
      unitsRequested: toFiniteNumber(totalRow?.unitsRequested),
      fulfilledUnits: toFiniteNumber(totalRow?.fulfilledUnits),
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
      fulfilledUnits: toFiniteNumber(row.fulfilledUnits),
      unfulfilledUnits: toFiniteNumber(row.unfulfilledUnits),
      requestCount: toFiniteNumber(row.requestCount),
    })),
    byDate: (byDateRows ?? []).map((row) => ({
      date: toDateOnlyString(row.date),
      unitsRequested: toFiniteNumber(row.unitsRequested),
      fulfilledUnits: toFiniteNumber(row.fulfilledUnits),
      unfulfilledUnits: toFiniteNumber(row.unfulfilledUnits),
    })),
  }
}

export type DonorEligibilityReportResult = {
  report: 'donor-eligibility'
  totals: Record<string, number>
  donors: Array<{
    donorId: number
    donorNumber: string
    name: string
    bloodGroup: PublicBloodGroupSummary | null
    donationCount: number
    lastDonationDate: string | null
    nextEligibleDate: string | null
    daysUntilEligible: number | null
    status: string
    reasons: string[]
  }>
}

export async function getDonorEligibilityReport(
  db: Db,
  query: DonorEligibilityReportQuery,
): Promise<DonorEligibilityReportResult> {
  const bloodGroupId = await resolveBloodGroupId(db, query.bloodGroupId, query.bloodGroup)
  const rows = await db
    .select({
      donorId: donors.id,
      donorNumber: donors.donorNumber,
      firstName: donors.firstName,
      lastName: donors.lastName,
      active: donors.active,
      dateOfBirth: donors.dateOfBirth,
      sex: donors.sex,
      weightKg: donors.weightKg,
      address: donors.address,
      phone: donors.phone,
      email: donors.email,
      bloodGroupId: donors.bloodGroupId,
      code: bloodGroups.code,
      abo: bloodGroups.abo,
      rh: bloodGroups.rh,
      donationCount: count(donations.id),
      lastDonationDate: max(donations.donationDate),
    })
    .from(donors)
    .innerJoin(bloodGroups, eq(donors.bloodGroupId, bloodGroups.id))
    .leftJoin(donations, eq(donations.donorId, donors.id))
    .where(typeof bloodGroupId === 'number' ? eq(donors.bloodGroupId, bloodGroupId) : undefined)
    .groupBy(
      donors.id,
      donors.donorNumber,
      donors.firstName,
      donors.lastName,
      donors.active,
      donors.dateOfBirth,
      donors.sex,
      donors.weightKg,
      donors.address,
      donors.phone,
      donors.email,
      donors.bloodGroupId,
      bloodGroups.code,
      bloodGroups.abo,
      bloodGroups.rh,
    )
    .orderBy(asc(donors.donorNumber))

  const totals: Record<string, number> = {
    total: 0,
    eligible: 0,
    waitingPeriod: 0,
    profileIncomplete: 0,
    otherIneligible: 0,
  }
  const result = (rows ?? []).map((row) => {
    const eligibility = calculateDonorEligibility({
      active: row.active,
      dateOfBirth: toDateOnlyString(row.dateOfBirth),
      sex: row.sex,
      weightKg: row.weightKg === null ? null : Number(row.weightKg),
      address: row.address,
      phone: row.phone,
      email: row.email,
      lastDonationDate: row.lastDonationDate ? toDateOnlyString(row.lastDonationDate) : null,
    })
    totals.total += 1
    if (eligibility.status === 'ELIGIBLE') totals.eligible += 1
    else if (eligibility.status === 'WAITING_PERIOD') totals.waitingPeriod += 1
    else if (eligibility.status === 'PROFILE_INCOMPLETE') totals.profileIncomplete += 1
    else totals.otherIneligible += 1
    return {
      donorId: row.donorId,
      donorNumber: row.donorNumber,
      name: `${row.firstName} ${row.lastName}`.trim(),
      bloodGroup: toPublicBloodGroup({ id: row.bloodGroupId, code: row.code, abo: row.abo, rh: row.rh }),
      donationCount: toFiniteNumber(row.donationCount),
      lastDonationDate: row.lastDonationDate ? toDateOnlyString(row.lastDonationDate) : null,
      nextEligibleDate: eligibility.nextEligibleDate,
      daysUntilEligible: eligibility.daysUntilEligible,
      status: eligibility.status,
      reasons: eligibility.reasons,
    }
  })

  return { report: 'donor-eligibility', totals, donors: result }
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
