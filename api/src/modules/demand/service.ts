/**
 * Demand records data access (docs/06 demand_records; TODO.md §5).
 * Syncs from approved operational blood requests; exports AI history/series.
 */

import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm'

import type { Db, DbTransaction } from '../../db'
import { withTransaction } from '../../db'
import {
  bloodGroups,
  bloodRequests,
  demandRecords,
  healthcareFacilities,
} from '../../db/schema'
import type { DemandSource } from '../../db/schema/enums'
import { AppError } from '../../lib/errors'
import type {
  BloodGroup,
  HistoryPoint,
  TrainingSeriesPoint,
} from '../../services/ai/types'
import {
  aggregateDemandBuckets,
  DEMAND_SYNC_STATUSES,
  demandBucketKey,
  toDateOnlyString,
  type DemandBucket,
} from './aggregate'
import type {
  ExportDemandQuery,
  ListDemandRecordsQuery,
  SyncDemandBody,
} from './schemas'
import {
  toAiHistoryPoints,
  toAiTrainingSeries,
  toPublicDemandRecord,
  type BloodGroupJoinRow,
  type DemandRecordRow,
  type PublicDemandRecord,
} from './serialize'

type Executor = Db | DbTransaction

const BLOOD_REQUEST_SOURCE: DemandSource = 'BLOOD_REQUEST'

function mapDemandRow(row: typeof demandRecords.$inferSelect): DemandRecordRow {
  return {
    id: row.id,
    facilityId: row.facilityId ?? null,
    bloodGroupId: row.bloodGroupId,
    date: row.date,
    unitsRequested: row.unitsRequested ?? 0,
    unitsIssued: row.unitsIssued ?? 0,
    unitsUsed: row.unitsUsed ?? null,
    unfulfilledUnits: row.unfulfilledUnits ?? null,
    source: row.source ?? 'SYSTEM',
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

async function requireBloodGroupCode(
  db: Executor,
  bloodGroupId: number,
): Promise<BloodGroup> {
  const rows = await db
    .select({ code: bloodGroups.code })
    .from(bloodGroups)
    .where(eq(bloodGroups.id, bloodGroupId))
    .limit(1)
  const code = rows?.[0]?.code
  if (!code) {
    throw AppError.validation('Invalid blood group', [
      {
        path: 'bloodGroupId',
        message: 'Blood group does not exist',
        code: 'invalid_blood_group',
      },
    ])
  }
  return code as BloodGroup
}

async function assertFacilityExists(
  db: Executor,
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

type DemandFilters = {
  bloodGroupId?: number
  facilityId?: number
  from?: string
  to?: string
  source?: DemandSource
}

function buildDemandWhere(filters: DemandFilters): SQL | undefined {
  const parts: SQL[] = []

  if (typeof filters.bloodGroupId === 'number') {
    parts.push(eq(demandRecords.bloodGroupId, filters.bloodGroupId))
  }
  if (typeof filters.facilityId === 'number') {
    parts.push(eq(demandRecords.facilityId, filters.facilityId))
  }
  if (filters.from) {
    parts.push(gte(demandRecords.date, filters.from))
  }
  if (filters.to) {
    parts.push(lte(demandRecords.date, filters.to))
  }
  if (filters.source) {
    parts.push(eq(demandRecords.source, filters.source))
  }

  if (parts.length === 0) {
    return undefined
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return and(...parts)
}

export type ListDemandRecordsResult = {
  items: PublicDemandRecord[]
  total: number
  limit: number
  offset: number
}

export async function listDemandRecords(
  db: Db,
  query: ListDemandRecordsQuery,
): Promise<ListDemandRecordsResult> {
  const limit = query.limit ?? 100
  const offset = query.offset ?? 0

  const bloodGroupId = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )
  if (typeof query.facilityId === 'number') {
    await assertFacilityExists(db, query.facilityId)
  }

  const whereClause = buildDemandWhere({
    bloodGroupId,
    facilityId: query.facilityId,
    from: query.from,
    to: query.to,
    source: query.source,
  })

  const [totalRow] = await db
    .select({ value: count() })
    .from(demandRecords)
    .where(whereClause)

  const total = Number(totalRow?.value ?? 0)

  const rows = await db
    .select({
      record: demandRecords,
      bloodGroup: bloodGroups,
    })
    .from(demandRecords)
    .leftJoin(bloodGroups, eq(demandRecords.bloodGroupId, bloodGroups.id))
    .where(whereClause)
    .orderBy(asc(demandRecords.date), asc(demandRecords.id))
    .limit(limit)
    .offset(offset)

  const items = (rows ?? [])
    .map((row) =>
      toPublicDemandRecord(
        row?.record ? mapDemandRow(row.record) : null,
        mapBloodGroupRow(row?.bloodGroup),
      ),
    )
    .filter((item): item is PublicDemandRecord => item !== null)

  return { items, total, limit, offset }
}

async function loadDemandRecordsForExport(
  db: Db,
  filters: DemandFilters,
): Promise<PublicDemandRecord[]> {
  const whereClause = buildDemandWhere(filters)

  const rows = await db
    .select({
      record: demandRecords,
      bloodGroup: bloodGroups,
    })
    .from(demandRecords)
    .leftJoin(bloodGroups, eq(demandRecords.bloodGroupId, bloodGroups.id))
    .where(whereClause)
    .orderBy(asc(demandRecords.date), asc(demandRecords.id))

  return (rows ?? [])
    .map((row) =>
      toPublicDemandRecord(
        row?.record ? mapDemandRow(row.record) : null,
        mapBloodGroupRow(row?.bloodGroup),
      ),
    )
    .filter((item): item is PublicDemandRecord => item !== null)
}

export type ExportDemandHistoryResult = {
  format: 'history'
  blood_group: BloodGroup
  facility_id: string | null
  history: HistoryPoint[]
}

export type ExportDemandSeriesResult = {
  format: 'series'
  series: TrainingSeriesPoint[]
}

export type ExportDemandResult =
  | ExportDemandHistoryResult
  | ExportDemandSeriesResult

/**
 * Export demand time-series in AI contract shapes (docs/14).
 * history → ForecastRequest.history; series → TrainRequest.series.
 */
export async function exportDemandSeries(
  db: Db,
  query: ExportDemandQuery,
): Promise<ExportDemandResult> {
  const bloodGroupId = await resolveBloodGroupId(
    db,
    query.bloodGroupId,
    query.bloodGroup,
  )
  if (typeof query.facilityId === 'number') {
    await assertFacilityExists(db, query.facilityId)
  }

  const format = query.format ?? 'history'
  const records = await loadDemandRecordsForExport(db, {
    bloodGroupId,
    facilityId: query.facilityId,
    from: query.from,
    to: query.to,
    source: query.source,
  })

  if (format === 'series') {
    return {
      format: 'series',
      series: toAiTrainingSeries(records),
    }
  }

  if (typeof bloodGroupId !== 'number') {
    throw AppError.validation('bloodGroup is required for format=history', [
      {
        path: 'bloodGroup',
        message: 'bloodGroup or bloodGroupId is required for format=history',
        code: 'required',
      },
    ])
  }

  const bloodGroupCode = await requireBloodGroupCode(db, bloodGroupId)

  return {
    format: 'history',
    blood_group: bloodGroupCode,
    facility_id:
      typeof query.facilityId === 'number' ? String(query.facilityId) : null,
    history: toAiHistoryPoints(records),
  }
}

export type SyncDemandResult = {
  inserted: number
  updated: number
  deleted: number
  buckets: number
}

type ExistingDemandRow = {
  id: number
  facilityId: number | null
  bloodGroupId: number
  date: Date | string
  unitsRequested: number
  unitsIssued: number
  unfulfilledUnits: number | null
}

/**
 * Idempotent rebuild of BLOOD_REQUEST-sourced demand_records from
 * APPROVED / PARTIAL / FULFILLED blood requests in an optional window.
 *
 * Strategy (no unique DB constraint):
 * 1. Aggregate operational requests into buckets
 * 2. Load existing BLOOD_REQUEST rows in the same scope
 * 3. Update matching keys, insert missing, delete stale BLOOD_REQUEST rows
 * MANUAL / IMPORT / SYSTEM rows are never touched.
 */
export async function syncDemandFromBloodRequests(
  db: Db,
  body: SyncDemandBody = {},
): Promise<SyncDemandResult> {
  const bloodGroupId = await resolveBloodGroupId(
    db,
    body.bloodGroupId,
    body.bloodGroup,
  )
  if (typeof body.facilityId === 'number') {
    await assertFacilityExists(db, body.facilityId)
  }

  return withTransaction(db, async (tx) => {
    const requestParts: SQL[] = [
      inArray(bloodRequests.status, [...DEMAND_SYNC_STATUSES]),
    ]
    if (typeof bloodGroupId === 'number') {
      requestParts.push(eq(bloodRequests.bloodGroupId, bloodGroupId))
    }
    if (typeof body.facilityId === 'number') {
      requestParts.push(eq(bloodRequests.facilityId, body.facilityId))
    }
    if (body.from) {
      requestParts.push(
        gte(sql`DATE(${bloodRequests.requestedAt})`, body.from),
      )
    }
    if (body.to) {
      requestParts.push(lte(sql`DATE(${bloodRequests.requestedAt})`, body.to))
    }

    const requestWhere =
      requestParts.length === 1 ? requestParts[0] : and(...requestParts)

    const requestRows = await tx
      .select({
        facilityId: bloodRequests.facilityId,
        bloodGroupId: bloodRequests.bloodGroupId,
        unitsRequested: bloodRequests.unitsRequested,
        fulfilledUnits: bloodRequests.fulfilledUnits,
        status: bloodRequests.status,
        requestedAt: bloodRequests.requestedAt,
      })
      .from(bloodRequests)
      .where(requestWhere)

    const buckets = aggregateDemandBuckets(
      (requestRows ?? []).map((row) => ({
        facilityId: row.facilityId,
        bloodGroupId: row.bloodGroupId,
        unitsRequested: row.unitsRequested ?? 0,
        fulfilledUnits: row.fulfilledUnits ?? 0,
        status: row.status,
        requestedAt: row.requestedAt,
      })),
    )

    const existingParts: SQL[] = [
      eq(demandRecords.source, BLOOD_REQUEST_SOURCE),
    ]
    if (typeof bloodGroupId === 'number') {
      existingParts.push(eq(demandRecords.bloodGroupId, bloodGroupId))
    }
    if (typeof body.facilityId === 'number') {
      existingParts.push(eq(demandRecords.facilityId, body.facilityId))
    }
    if (body.from) {
      existingParts.push(gte(demandRecords.date, body.from))
    }
    if (body.to) {
      existingParts.push(lte(demandRecords.date, body.to))
    }

    const existingWhere =
      existingParts.length === 1 ? existingParts[0] : and(...existingParts)

    const existingRows = await tx
      .select({
        id: demandRecords.id,
        facilityId: demandRecords.facilityId,
        bloodGroupId: demandRecords.bloodGroupId,
        date: demandRecords.date,
        unitsRequested: demandRecords.unitsRequested,
        unitsIssued: demandRecords.unitsIssued,
        unfulfilledUnits: demandRecords.unfulfilledUnits,
      })
      .from(demandRecords)
      .where(existingWhere)

    return applyDemandBucketSync(tx, buckets, existingRows ?? [])
  })
}

async function applyDemandBucketSync(
  tx: DbTransaction,
  buckets: DemandBucket[],
  existingRows: ExistingDemandRow[],
): Promise<SyncDemandResult> {
  const existingByKey = new Map<string, ExistingDemandRow>()
  for (const row of existingRows) {
    const facilityId = row.facilityId
    if (typeof facilityId !== 'number') {
      continue
    }
    const date = toDateOnlyString(row.date)
    if (!date) {
      continue
    }
    existingByKey.set(
      demandBucketKey(date, row.bloodGroupId, facilityId),
      row,
    )
  }

  const seenKeys = new Set<string>()
  let inserted = 0
  let updated = 0

  for (const bucket of buckets) {
    const key = demandBucketKey(
      bucket.date,
      bucket.bloodGroupId,
      bucket.facilityId,
    )
    seenKeys.add(key)
    const existing = existingByKey.get(key)

    if (existing) {
      const same =
        (existing.unitsRequested ?? 0) === bucket.unitsRequested &&
        (existing.unitsIssued ?? 0) === bucket.unitsIssued &&
        (existing.unfulfilledUnits ?? null) === bucket.unfulfilledUnits

      if (!same) {
        await tx
          .update(demandRecords)
          .set({
            unitsRequested: bucket.unitsRequested,
            unitsIssued: bucket.unitsIssued,
            unfulfilledUnits: bucket.unfulfilledUnits,
            source: BLOOD_REQUEST_SOURCE,
          })
          .where(eq(demandRecords.id, existing.id))
        updated += 1
      }
      continue
    }

    await tx.insert(demandRecords).values({
      facilityId: bucket.facilityId,
      bloodGroupId: bucket.bloodGroupId,
      date: bucket.date,
      unitsRequested: bucket.unitsRequested,
      unitsIssued: bucket.unitsIssued,
      unitsUsed: null,
      unfulfilledUnits: bucket.unfulfilledUnits,
      source: BLOOD_REQUEST_SOURCE,
    })
    inserted += 1
  }

  const staleIds: number[] = []
  for (const [key, row] of existingByKey) {
    if (!seenKeys.has(key)) {
      staleIds.push(row.id)
    }
  }

  let deleted = 0
  if (staleIds.length > 0) {
    await tx
      .delete(demandRecords)
      .where(inArray(demandRecords.id, staleIds))
    deleted = staleIds.length
  }

  return {
    inserted,
    updated,
    deleted,
    buckets: buckets.length,
  }
}
