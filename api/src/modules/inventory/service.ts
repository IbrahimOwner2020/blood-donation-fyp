/**
 * Inventory persistence — list, detail, summary, low-stock, expiring, PATCH
 * (docs/04, docs/06, docs/08 supply formula; TODO.md §4).
 *
 * Donation create path owns unit insertion — this module does not create units.
 */

import {
  and,
  asc,
  count,
  eq,
  gte,
  lte,
  type SQL,
} from 'drizzle-orm'

import type { Db, DbTransaction } from '../../db'
import {
  bloodGroups,
  bloodInventory,
  healthcareFacilities,
} from '../../db/schema'
import type { InventoryStatus } from '../../db/schema/enums'
import { AppError } from '../../lib/errors'
import {
  addUtcDays,
  summarizeByBloodGroup,
  toDateOnlyString,
  utcTodayDateOnly,
  type BloodGroupInventoryCounts,
  type InventoryUnitSnapshot,
} from './availability'
import type {
  InventoryExpiringQuery,
  InventoryLowStockQuery,
  InventorySummaryQuery,
  ListInventoryQuery,
  UpdateInventoryBody,
} from './schemas'
import {
  toPublicInventoryUnit,
  type BloodGroupRow,
  type FacilitySummaryRow,
  type InventoryRow,
  type PublicInventoryUnit,
} from './serialize'
import { assertInventoryStatusTransition } from './status-machine'

type Executor = Db | DbTransaction

function mapInventoryRow(
  row: typeof bloodInventory.$inferSelect,
): InventoryRow {
  return {
    id: row.id,
    donationId: row.donationId ?? null,
    bloodGroupId: row.bloodGroupId,
    collectionDate: row.collectionDate,
    expiryDate: row.expiryDate,
    status: row.status,
    facilityId: row.facilityId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapBloodGroupRow(
  row: typeof bloodGroups.$inferSelect | null | undefined,
): BloodGroupRow | null {
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

function mapFacilitySummary(
  row: typeof healthcareFacilities.$inferSelect | null | undefined,
): FacilitySummaryRow | null {
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

async function findBloodGroupByCode(
  db: Executor,
  code: string,
): Promise<BloodGroupRow | null> {
  const rows = await db
    .select()
    .from(bloodGroups)
    .where(eq(bloodGroups.code, code))
    .limit(1)
  return mapBloodGroupRow(rows?.[0])
}

async function requireFacilityIfProvided(
  db: Executor,
  facilityId: number | null | undefined,
): Promise<number | null | undefined> {
  if (facilityId === undefined) {
    return undefined
  }
  if (facilityId === null) {
    return null
  }

  const rows = await db
    .select({ id: healthcareFacilities.id, active: healthcareFacilities.active })
    .from(healthcareFacilities)
    .where(eq(healthcareFacilities.id, facilityId))
    .limit(1)

  const facility = rows?.[0]
  if (!facility?.id) {
    throw AppError.validation('Invalid facility', [
      {
        path: 'facilityId',
        message: 'Facility does not exist',
        code: 'invalid_facility',
      },
    ])
  }

  if (!facility.active) {
    throw AppError.validation('Facility is inactive', [
      {
        path: 'facilityId',
        message: 'Facility is inactive',
        code: 'inactive_facility',
      },
    ])
  }

  return facility.id
}

type LoadedUnit = {
  unit: InventoryRow
  bloodGroup: BloodGroupRow | null
  facility: FacilitySummaryRow | null
}

async function loadUnit(
  db: Executor,
  inventoryId: number,
): Promise<LoadedUnit | null> {
  const rows = await db
    .select({
      unit: bloodInventory,
      bloodGroup: bloodGroups,
      facility: healthcareFacilities,
    })
    .from(bloodInventory)
    .leftJoin(bloodGroups, eq(bloodInventory.bloodGroupId, bloodGroups.id))
    .leftJoin(
      healthcareFacilities,
      eq(bloodInventory.facilityId, healthcareFacilities.id),
    )
    .where(eq(bloodInventory.id, inventoryId))
    .limit(1)

  const match = rows?.[0]
  if (!match?.unit?.id) {
    return null
  }

  return {
    unit: mapInventoryRow(match.unit),
    bloodGroup: mapBloodGroupRow(match.bloodGroup),
    facility: mapFacilitySummary(match.facility),
  }
}

function toPublicOrThrow(
  loaded: LoadedUnit | null,
  asOf: string,
): PublicInventoryUnit {
  const publicUnit = toPublicInventoryUnit(
    loaded?.unit,
    {
      bloodGroup: loaded?.bloodGroup,
      facility: loaded?.facility,
    },
    { asOf },
  )
  if (!publicUnit) {
    throw AppError.internal('Failed to serialize inventory unit')
  }
  return publicUnit
}

function buildListConditions(
  filters: ListInventoryQuery,
  resolvedBloodGroupId: number | undefined,
  asOf: string,
): SQL | undefined {
  const parts: SQL[] = []

  if (typeof resolvedBloodGroupId === 'number') {
    parts.push(eq(bloodInventory.bloodGroupId, resolvedBloodGroupId))
  }
  if (filters.status) {
    parts.push(eq(bloodInventory.status, filters.status))
  }
  if (typeof filters.facilityId === 'number') {
    parts.push(eq(bloodInventory.facilityId, filters.facilityId))
  }
  if (typeof filters.donationId === 'number') {
    parts.push(eq(bloodInventory.donationId, filters.donationId))
  }
  if (filters.expiryFrom) {
    parts.push(gte(bloodInventory.expiryDate, filters.expiryFrom))
  }
  if (filters.expiryTo) {
    parts.push(lte(bloodInventory.expiryDate, filters.expiryTo))
  }
  if (filters.availableOnly) {
    parts.push(eq(bloodInventory.status, 'AVAILABLE'))
    parts.push(gte(bloodInventory.expiryDate, asOf))
  }

  if (parts.length === 0) {
    return undefined
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return and(...parts)
}

export type ListInventoryResult = {
  items: PublicInventoryUnit[]
  total: number
  limit: number
  offset: number
  asOf: string
}

export async function listInventory(
  db: Db,
  query: ListInventoryQuery,
): Promise<ListInventoryResult> {
  const limit = query.limit ?? 50
  const offset = query.offset ?? 0
  const asOf = query.asOf ?? utcTodayDateOnly()

  let resolvedBloodGroupId = query.bloodGroupId
  if (query.bloodGroup && resolvedBloodGroupId === undefined) {
    const group = await findBloodGroupByCode(db, query.bloodGroup)
    if (!group) {
      return { items: [], total: 0, limit, offset, asOf }
    }
    resolvedBloodGroupId = group.id
  }

  const whereClause = buildListConditions(query, resolvedBloodGroupId, asOf)

  const [totalRow] = await db
    .select({ value: count() })
    .from(bloodInventory)
    .where(whereClause)

  const total = Number(totalRow?.value ?? 0)

  const rows = await db
    .select({
      unit: bloodInventory,
      bloodGroup: bloodGroups,
      facility: healthcareFacilities,
    })
    .from(bloodInventory)
    .leftJoin(bloodGroups, eq(bloodInventory.bloodGroupId, bloodGroups.id))
    .leftJoin(
      healthcareFacilities,
      eq(bloodInventory.facilityId, healthcareFacilities.id),
    )
    .where(whereClause)
    .orderBy(asc(bloodInventory.expiryDate), asc(bloodInventory.id))
    .limit(limit)
    .offset(offset)

  const items = (rows ?? [])
    .map((row) =>
      toPublicInventoryUnit(
        row?.unit ? mapInventoryRow(row.unit) : null,
        {
          bloodGroup: mapBloodGroupRow(row?.bloodGroup),
          facility: mapFacilitySummary(row?.facility),
        },
        { asOf },
      ),
    )
    .filter((item): item is PublicInventoryUnit => item !== null)

  return { items, total, limit, offset, asOf }
}

export async function getInventoryById(
  db: Executor,
  inventoryId: number,
  asOf: string = utcTodayDateOnly(),
): Promise<PublicInventoryUnit> {
  const loaded = await loadUnit(db, inventoryId)
  if (!loaded) {
    throw AppError.notFound('Inventory unit not found')
  }
  return toPublicOrThrow(loaded, asOf)
}

/**
 * Load all units (optionally facility-scoped) and aggregate with pure helpers
 * so available counts exclude past-expiry AVAILABLE rows (docs/08).
 */
async function loadSnapshotsForSummary(
  db: Db,
  facilityId: number | undefined,
): Promise<{
  snapshots: InventoryUnitSnapshot[]
  codeMap: Map<number, string>
}> {
  const whereClause =
    typeof facilityId === 'number'
      ? eq(bloodInventory.facilityId, facilityId)
      : undefined

  const rows = await db
    .select({
      bloodGroupId: bloodInventory.bloodGroupId,
      status: bloodInventory.status,
      expiryDate: bloodInventory.expiryDate,
      bloodGroupCode: bloodGroups.code,
    })
    .from(bloodInventory)
    .leftJoin(bloodGroups, eq(bloodInventory.bloodGroupId, bloodGroups.id))
    .where(whereClause)

  const codeMap = new Map<number, string>()
  const snapshots: InventoryUnitSnapshot[] = []

  for (const row of rows ?? []) {
    if (typeof row?.bloodGroupId !== 'number') {
      continue
    }
    const code = row.bloodGroupCode ?? undefined
    if (code) {
      codeMap.set(row.bloodGroupId, code)
    }
    snapshots.push({
      bloodGroupId: row.bloodGroupId,
      bloodGroupCode: code,
      status: row.status,
      expiryDate: toDateOnlyString(row.expiryDate),
    })
  }

  // Ensure all seeded blood groups appear in summary (zero counts).
  const allGroups = await db
    .select()
    .from(bloodGroups)
    .orderBy(asc(bloodGroups.id))
  for (const group of allGroups ?? []) {
    if (group?.id && group?.code) {
      codeMap.set(group.id, group.code)
    }
  }

  return { snapshots, codeMap }
}

function padSummaryWithAllGroups(
  summaries: BloodGroupInventoryCounts[],
  codeMap: Map<number, string>,
  lowStockThreshold: number,
): BloodGroupInventoryCounts[] {
  const byId = new Map(summaries.map((s) => [s.bloodGroupId, s]))
  const result: BloodGroupInventoryCounts[] = []

  const ids = Array.from(codeMap.keys()).sort((a, b) => a - b)
  for (const id of ids) {
    const existing = byId.get(id)
    if (existing) {
      result.push(existing)
      continue
    }
    result.push({
      bloodGroupId: id,
      bloodGroupCode: codeMap.get(id) ?? null,
      availableUnits: 0,
      reservedUnits: 0,
      issuedUnits: 0,
      discardedUnits: 0,
      expiredUnits: 0,
      expiringSoonUnits: 0,
      lowStock: 0 <= lowStockThreshold,
    })
  }
  return result
}

export type InventorySummaryResult = {
  asOf: string
  expiringWithinDays: number
  lowStockThreshold: number
  groups: BloodGroupInventoryCounts[]
  totals: {
    availableUnits: number
    reservedUnits: number
    issuedUnits: number
    discardedUnits: number
    expiredUnits: number
    expiringSoonUnits: number
    lowStockGroupCount: number
  }
}

export async function getInventorySummary(
  db: Db,
  query: InventorySummaryQuery,
): Promise<InventorySummaryResult> {
  const asOf = query.asOf ?? utcTodayDateOnly()
  const expiringWithinDays = query.expiringWithinDays
  const lowStockThreshold = query.lowStockThreshold

  const { snapshots, codeMap } = await loadSnapshotsForSummary(
    db,
    query.facilityId,
  )

  const aggregated = summarizeByBloodGroup(snapshots, {
    asOf,
    expiringWithinDays,
    lowStockThreshold,
    bloodGroupCodes: codeMap,
  })

  const groups = padSummaryWithAllGroups(
    aggregated,
    codeMap,
    lowStockThreshold,
  )

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
    asOf,
    expiringWithinDays,
    lowStockThreshold,
    groups,
    totals,
  }
}

export type InventoryLowStockResult = {
  asOf: string
  threshold: number
  groups: BloodGroupInventoryCounts[]
}

export async function getInventoryLowStock(
  db: Db,
  query: InventoryLowStockQuery,
): Promise<InventoryLowStockResult> {
  const summary = await getInventorySummary(db, {
    asOf: query.asOf,
    facilityId: query.facilityId,
    expiringWithinDays: query.expiringWithinDays,
    lowStockThreshold: query.threshold,
  })

  const groups = summary.groups.filter(
    (g) => g.availableUnits <= query.threshold,
  )

  return {
    asOf: summary.asOf,
    threshold: query.threshold,
    groups,
  }
}

export type InventoryExpiringResult = {
  items: PublicInventoryUnit[]
  total: number
  limit: number
  offset: number
  asOf: string
  withinDays: number
  windowEnd: string
}

export async function listExpiringInventory(
  db: Db,
  query: InventoryExpiringQuery,
): Promise<InventoryExpiringResult> {
  const limit = query.limit ?? 50
  const offset = query.offset ?? 0
  const asOf = query.asOf ?? utcTodayDateOnly()
  const withinDays = query.withinDays
  const windowEnd = addUtcDays(asOf, withinDays)

  const parts: SQL[] = [
    eq(bloodInventory.status, 'AVAILABLE'),
    gte(bloodInventory.expiryDate, asOf),
    lte(bloodInventory.expiryDate, windowEnd),
  ]

  if (typeof query.facilityId === 'number') {
    parts.push(eq(bloodInventory.facilityId, query.facilityId))
  }
  if (typeof query.bloodGroupId === 'number') {
    parts.push(eq(bloodInventory.bloodGroupId, query.bloodGroupId))
  }

  const whereClause = and(...parts)

  const [totalRow] = await db
    .select({ value: count() })
    .from(bloodInventory)
    .where(whereClause)

  const total = Number(totalRow?.value ?? 0)

  const rows = await db
    .select({
      unit: bloodInventory,
      bloodGroup: bloodGroups,
      facility: healthcareFacilities,
    })
    .from(bloodInventory)
    .leftJoin(bloodGroups, eq(bloodInventory.bloodGroupId, bloodGroups.id))
    .leftJoin(
      healthcareFacilities,
      eq(bloodInventory.facilityId, healthcareFacilities.id),
    )
    .where(whereClause)
    .orderBy(asc(bloodInventory.expiryDate), asc(bloodInventory.id))
    .limit(limit)
    .offset(offset)

  const items = (rows ?? [])
    .map((row) =>
      toPublicInventoryUnit(
        row?.unit ? mapInventoryRow(row.unit) : null,
        {
          bloodGroup: mapBloodGroupRow(row?.bloodGroup),
          facility: mapFacilitySummary(row?.facility),
        },
        { asOf },
      ),
    )
    .filter((item): item is PublicInventoryUnit => item !== null)

  return { items, total, limit, offset, asOf, withinDays, windowEnd }
}

export type UpdateInventoryResult = {
  unit: PublicInventoryUnit
  previousStatus: InventoryStatus
  previousFacilityId: number | null
}

/**
 * PATCH status and/or facility. Does not create units.
 */
export async function updateInventoryUnit(
  db: Db,
  inventoryId: number,
  body: UpdateInventoryBody,
): Promise<UpdateInventoryResult> {
  const loaded = await loadUnit(db, inventoryId)
  if (!loaded) {
    throw AppError.notFound('Inventory unit not found')
  }

  const previousStatus = loaded.unit.status
  const previousFacilityId = loaded.unit.facilityId

  const patch: {
    status?: InventoryStatus
    facilityId?: number | null
  } = {}

  if (body.status !== undefined) {
    patch.status = assertInventoryStatusTransition(previousStatus, body.status)
  }

  if (body.facilityId !== undefined) {
    const facilityId = await requireFacilityIfProvided(db, body.facilityId)
    if (facilityId !== undefined) {
      patch.facilityId = facilityId
    }
  }

  if (Object.keys(patch).length === 0) {
    throw AppError.validation('At least one field is required')
  }

  await db
    .update(bloodInventory)
    .set(patch)
    .where(eq(bloodInventory.id, inventoryId))

  const unit = await getInventoryById(db, inventoryId)
  return { unit, previousStatus, previousFacilityId }
}
