/**
 * Public shortage-alert DTOs (docs/04 alerts/, docs/06 shortage_alerts).
 */

import type {
  AlertSeverity,
  AlertStatus,
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
}

export type PublicAlert = {
  id: number
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  facilityId: number | null
  facility: PublicFacilitySummary | null
  predictionId: number
  availableUnits: number
  predictedUnits: number
  projectedGap: number
  severity: AlertSeverity
  status: AlertStatus
  createdAt: Date
  resolvedAt: Date | null
}

export type AlertRow = {
  id: number
  bloodGroupId: number
  facilityId: number | null
  predictionId: number
  availableUnits: string | number
  predictedUnits: string | number
  projectedGap: string | number
  severity: AlertSeverity
  status: AlertStatus
  createdAt: Date
  resolvedAt: Date | null
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

export function toDecimalNumber(
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
  if (!row?.id) {
    return null
  }
  return {
    id: row.id,
    code: row.code ?? '',
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

export function toPublicAlert(
  row: AlertRow | null | undefined,
  joins: {
    bloodGroup?: BloodGroupJoinRow | null
    facility?: FacilityJoinRow | null
  } = {},
): PublicAlert | null {
  if (!row?.id) {
    return null
  }
  return {
    id: row.id,
    bloodGroupId: row.bloodGroupId,
    bloodGroup: toPublicBloodGroupSummary(joins.bloodGroup),
    facilityId: row.facilityId ?? null,
    facility: toPublicFacilitySummary(joins.facility),
    predictionId: row.predictionId,
    availableUnits: toDecimalNumber(row.availableUnits),
    predictedUnits: toDecimalNumber(row.predictedUnits),
    projectedGap: toDecimalNumber(row.projectedGap),
    severity: row.severity,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
  }
}
