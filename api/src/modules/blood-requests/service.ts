/**
 * Blood requests data access (docs/06 blood_requests; TODO.md §5).
 * Status transitions enforced via status-machine (API is business-logic authority).
 */

import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm'

import type { Db } from '../../db'
import {
  bloodGroups,
  bloodRequests,
  healthcareFacilities,
} from '../../db/schema'
import type {
  BloodRequestPriority,
  BloodRequestStatus,
} from '../../db/schema/enums'
import { AppError } from '../../lib/errors'
import type {
  CreateBloodRequestBody,
  ListBloodRequestsQuery,
  PatchBloodRequestBody,
} from './schemas'
import {
  toPublicBloodRequest,
  type BloodGroupJoinRow,
  type BloodRequestRow,
  type FacilityJoinRow,
  type PublicBloodRequest,
} from './serialize'
import { assertStatusTransition } from './status-machine'

type LoadedBloodRequest = {
  request: BloodRequestRow
  facility: FacilityJoinRow | null
  bloodGroup: BloodGroupJoinRow | null
}

function mapRequestRow(
  row: typeof bloodRequests.$inferSelect,
): BloodRequestRow {
  return {
    id: row.id,
    facilityId: row.facilityId,
    bloodGroupId: row.bloodGroupId,
    unitsRequested: row.unitsRequested,
    priority: row.priority,
    requestedAt: row.requestedAt,
    requiredAt: row.requiredAt ?? null,
    status: row.status,
    fulfilledUnits: row.fulfilledUnits,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
    active: Boolean(row.active),
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

function toPublicOrThrow(loaded: LoadedBloodRequest | null): PublicBloodRequest {
  const publicRequest = toPublicBloodRequest(
    loaded?.request,
    loaded?.facility,
    loaded?.bloodGroup,
  )
  if (!publicRequest) {
    throw AppError.internal('Failed to serialize blood request')
  }
  return publicRequest
}

async function requireActiveFacility(
  db: Db,
  facilityId: number,
): Promise<FacilityJoinRow> {
  const rows = await db
    .select()
    .from(healthcareFacilities)
    .where(eq(healthcareFacilities.id, facilityId))
    .limit(1)

  const facility = mapFacilityRow(rows?.[0])
  if (!facility) {
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
        message: 'Facility must be active to create a blood request',
        code: 'inactive_facility',
      },
    ])
  }
  return facility
}

async function requireBloodGroup(
  db: Db,
  bloodGroupId: number,
): Promise<BloodGroupJoinRow> {
  const rows = await db
    .select()
    .from(bloodGroups)
    .where(eq(bloodGroups.id, bloodGroupId))
    .limit(1)

  const group = mapBloodGroupRow(rows?.[0])
  if (!group) {
    throw AppError.validation('Invalid blood group', [
      {
        path: 'bloodGroupId',
        message: 'Blood group does not exist',
        code: 'invalid_blood_group',
      },
    ])
  }
  return group
}

async function loadBloodRequest(
  db: Db,
  id: number,
): Promise<LoadedBloodRequest | null> {
  const rows = await db
    .select({
      request: bloodRequests,
      facility: healthcareFacilities,
      bloodGroup: bloodGroups,
    })
    .from(bloodRequests)
    .leftJoin(
      healthcareFacilities,
      eq(bloodRequests.facilityId, healthcareFacilities.id),
    )
    .leftJoin(bloodGroups, eq(bloodRequests.bloodGroupId, bloodGroups.id))
    .where(eq(bloodRequests.id, id))
    .limit(1)

  const match = rows?.[0]
  if (!match?.request?.id) {
    return null
  }

  return {
    request: mapRequestRow(match.request),
    facility: mapFacilityRow(match.facility),
    bloodGroup: mapBloodGroupRow(match.bloodGroup),
  }
}

function buildListConditions(filters: ListBloodRequestsQuery): SQL | undefined {
  const parts: SQL[] = []

  if (typeof filters.facilityId === 'number') {
    parts.push(eq(bloodRequests.facilityId, filters.facilityId))
  }
  if (typeof filters.bloodGroupId === 'number') {
    parts.push(eq(bloodRequests.bloodGroupId, filters.bloodGroupId))
  }
  if (filters.status) {
    parts.push(eq(bloodRequests.status, filters.status))
  }
  if (filters.priority) {
    parts.push(eq(bloodRequests.priority, filters.priority))
  }

  if (parts.length === 0) {
    return undefined
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return and(...parts)
}

export type ListBloodRequestsResult = {
  items: PublicBloodRequest[]
  total: number
  limit: number
  offset: number
}

export async function listBloodRequests(
  db: Db,
  query: ListBloodRequestsQuery,
): Promise<ListBloodRequestsResult> {
  const limit = query.limit ?? 50
  const offset = query.offset ?? 0
  const whereClause = buildListConditions(query)

  const [totalRow] = await db
    .select({ value: count() })
    .from(bloodRequests)
    .where(whereClause)

  const total = Number(totalRow?.value ?? 0)

  const rows = await db
    .select({
      request: bloodRequests,
      facility: healthcareFacilities,
      bloodGroup: bloodGroups,
    })
    .from(bloodRequests)
    .leftJoin(
      healthcareFacilities,
      eq(bloodRequests.facilityId, healthcareFacilities.id),
    )
    .leftJoin(bloodGroups, eq(bloodRequests.bloodGroupId, bloodGroups.id))
    .where(whereClause)
    .orderBy(desc(bloodRequests.requestedAt), asc(bloodRequests.id))
    .limit(limit)
    .offset(offset)

  const items = (rows ?? [])
    .map((row) =>
      toPublicBloodRequest(
        row?.request ? mapRequestRow(row.request) : null,
        mapFacilityRow(row?.facility),
        mapBloodGroupRow(row?.bloodGroup),
      ),
    )
    .filter((item): item is PublicBloodRequest => item !== null)

  return { items, total, limit, offset }
}

export async function getBloodRequestById(
  db: Db,
  id: number,
): Promise<PublicBloodRequest> {
  const loaded = await loadBloodRequest(db, id)
  if (!loaded) {
    throw AppError.notFound('Blood request not found')
  }
  return toPublicOrThrow(loaded)
}

export async function createBloodRequest(
  db: Db,
  body: CreateBloodRequestBody,
  createdByUserId: number,
): Promise<PublicBloodRequest> {
  if (
    typeof createdByUserId !== 'number' ||
    !Number.isFinite(createdByUserId) ||
    createdByUserId < 1
  ) {
    throw AppError.unauthorized('Authenticated user required')
  }

  await requireActiveFacility(db, body.facilityId)
  await requireBloodGroup(db, body.bloodGroupId)

  const priority: BloodRequestPriority = body.priority ?? 'MEDIUM'
  const status: BloodRequestStatus = 'PENDING'

  const inserted = await db
    .insert(bloodRequests)
    .values({
      facilityId: body.facilityId,
      bloodGroupId: body.bloodGroupId,
      unitsRequested: body.unitsRequested,
      priority,
      requestedAt: body.requestedAt ?? new Date(),
      requiredAt: body.requiredAt ?? null,
      status,
      fulfilledUnits: 0,
      createdBy: createdByUserId,
    })
    .$returningId()

  const insertedId = inserted?.[0]?.id
  if (typeof insertedId !== 'number' || !Number.isFinite(insertedId)) {
    throw AppError.internal('Failed to create blood request')
  }

  return getBloodRequestById(db, insertedId)
}

export type PatchBloodRequestResult = {
  bloodRequest: PublicBloodRequest
  previousStatus: BloodRequestStatus
  previousFulfilledUnits: number
  nextStatus: BloodRequestStatus
  nextFulfilledUnits: number
}

export async function patchBloodRequestStatus(
  db: Db,
  id: number,
  body: PatchBloodRequestBody,
): Promise<PatchBloodRequestResult> {
  const loaded = await loadBloodRequest(db, id)
  if (!loaded) {
    throw AppError.notFound('Blood request not found')
  }

  const previousStatus = loaded.request.status
  const previousFulfilledUnits = loaded.request.fulfilledUnits ?? 0

  const transition = assertStatusTransition(previousStatus, body.status, {
    unitsRequested: loaded.request.unitsRequested,
    currentFulfilledUnits: previousFulfilledUnits,
    nextFulfilledUnits: body.fulfilledUnits,
  })

  await db
    .update(bloodRequests)
    .set({
      status: transition.status,
      fulfilledUnits: transition.fulfilledUnits,
    })
    .where(eq(bloodRequests.id, id))

  const bloodRequest = await getBloodRequestById(db, id)

  return {
    bloodRequest,
    previousStatus,
    previousFulfilledUnits,
    nextStatus: transition.status,
    nextFulfilledUnits: transition.fulfilledUnits,
  }
}
