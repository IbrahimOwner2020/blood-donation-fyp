/**
 * Public blood-request DTOs — map Drizzle rows (+ joins) to API envelopes.
 */

import type {
  BloodRequestPriority,
  BloodRequestStatus,
} from '../../db/schema/enums'

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
  active: boolean
}

export type PublicBloodRequest = {
  id: number
  facilityId: number
  facility: PublicFacilitySummary | null
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  unitsRequested: number
  priority: BloodRequestPriority
  requestedAt: Date
  requiredAt: Date | null
  status: BloodRequestStatus
  fulfilledUnits: number
  createdBy: number
  createdAt: Date
  updatedAt: Date
}

export type BloodRequestRow = {
  id: number
  facilityId: number
  bloodGroupId: number
  unitsRequested: number
  priority: BloodRequestPriority
  requestedAt: Date
  requiredAt: Date | null
  status: BloodRequestStatus
  fulfilledUnits: number
  createdBy: number
  createdAt: Date
  updatedAt: Date
}

export type FacilityJoinRow = {
  id: number
  name: string
  region: string
  district: string
  active: boolean
}

export type BloodGroupJoinRow = {
  id: number
  code: string
  abo: string
  rh: string
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
    active: row.active ?? false,
  }
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

export function toPublicBloodRequest(
  request: BloodRequestRow | null | undefined,
  facility: FacilityJoinRow | null | undefined = null,
  bloodGroup: BloodGroupJoinRow | null | undefined = null,
): PublicBloodRequest | null {
  if (!request?.id) {
    return null
  }

  return {
    id: request.id,
    facilityId: request.facilityId,
    facility: toPublicFacilitySummary(facility),
    bloodGroupId: request.bloodGroupId,
    bloodGroup: toPublicBloodGroupSummary(bloodGroup),
    unitsRequested: request.unitsRequested,
    priority: request.priority ?? 'MEDIUM',
    requestedAt: request.requestedAt,
    requiredAt: request.requiredAt ?? null,
    status: request.status ?? 'PENDING',
    fulfilledUnits: request.fulfilledUnits ?? 0,
    createdBy: request.createdBy,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }
}
