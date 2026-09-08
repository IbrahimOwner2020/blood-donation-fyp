/**
 * Public inventory unit DTOs — unit-level blood_inventory rows (docs/06).
 */

import type { InventoryStatus } from '../../db/schema/enums'
import { toDateOnlyString } from './availability'

export type PublicBloodGroup = {
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

export type PublicInventoryUnit = {
  id: number
  donationId: number | null
  bloodGroupId: number
  bloodGroup: PublicBloodGroup | null
  collectionDate: string
  expiryDate: string
  status: InventoryStatus
  facilityId: number | null
  facility: PublicFacilitySummary | null
  createdAt: Date
  updatedAt: Date
  /** True when status is AVAILABLE and expiryDate >= asOf (docs/08). */
  effectivelyAvailable: boolean
}

export type InventoryRow = {
  id: number
  donationId: number | null
  bloodGroupId: number
  collectionDate: Date | string
  expiryDate: Date | string
  status: InventoryStatus
  facilityId: number | null
  createdAt: Date
  updatedAt: Date
}

export type BloodGroupRow = {
  id: number
  code: string
  abo: string
  rh: string
}

export type FacilitySummaryRow = {
  id: number
  name: string
  region: string
  district: string
}

export function toPublicBloodGroup(
  group: BloodGroupRow | null | undefined,
): PublicBloodGroup | null {
  if (!group?.id || !group?.code) {
    return null
  }
  return {
    id: group.id,
    code: group.code,
    abo: group.abo ?? '',
    rh: group.rh ?? '',
  }
}

export function toPublicFacilitySummary(
  facility: FacilitySummaryRow | null | undefined,
): PublicFacilitySummary | null {
  if (!facility?.id) {
    return null
  }
  return {
    id: facility.id,
    name: facility.name ?? '',
    region: facility.region ?? '',
    district: facility.district ?? '',
  }
}

export type ToPublicInventoryOptions = {
  /** YYYY-MM-DD reference for effectivelyAvailable (default: omit flag false). */
  asOf?: string
}

export function toPublicInventoryUnit(
  row: InventoryRow | null | undefined,
  relations: {
    bloodGroup?: BloodGroupRow | null
    facility?: FacilitySummaryRow | null
  } = {},
  options: ToPublicInventoryOptions = {},
): PublicInventoryUnit | null {
  if (!row?.id) {
    return null
  }

  const expiryDate = toDateOnlyString(row.expiryDate)
  const asOf = options.asOf ? toDateOnlyString(options.asOf) : ''
  const effectivelyAvailable =
    row.status === 'AVAILABLE' &&
    Boolean(asOf) &&
    Boolean(expiryDate) &&
    expiryDate >= asOf

  return {
    id: row.id,
    donationId: row.donationId ?? null,
    bloodGroupId: row.bloodGroupId,
    bloodGroup: toPublicBloodGroup(relations.bloodGroup),
    collectionDate: toDateOnlyString(row.collectionDate),
    expiryDate,
    status: row.status,
    facilityId: row.facilityId ?? null,
    facility: toPublicFacilitySummary(relations.facility),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    effectivelyAvailable,
  }
}
