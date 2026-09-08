/**
 * Public facility DTOs — map Drizzle rows to API envelopes.
 */

import type { healthcareFacilities } from '../../db/schema'

export type FacilityRow = typeof healthcareFacilities.$inferSelect

export type PublicFacility = {
  id: number
  name: string
  region: string
  district: string
  active: boolean
}

export function toPublicFacility(
  row: FacilityRow | null | undefined,
): PublicFacility | null {
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

export function toPublicFacilities(
  rows: FacilityRow[] | null | undefined,
): PublicFacility[] {
  return (rows ?? [])
    .map((row) => toPublicFacility(row))
    .filter((row): row is PublicFacility => row !== null)
}
