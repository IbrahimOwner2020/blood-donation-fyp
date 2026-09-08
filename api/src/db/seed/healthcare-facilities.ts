import { and, eq, inArray } from 'drizzle-orm'

import type { Db } from '../client'
import { healthcareFacilities } from '../schema'
import {
  HEALTHCARE_FACILITY_SEEDS,
  type HealthcareFacilitySeed,
} from './healthcare-facilities-data'

export interface SeedHealthcareFacilitiesResult {
  inserted: number
  skipped: number
  names: string[]
}

function seedKey(row: Pick<HealthcareFacilitySeed, 'name' | 'region' | 'district'>): string {
  return `${row.name.trim().toLowerCase()}|${row.region.trim().toLowerCase()}|${row.district.trim().toLowerCase()}`
}

/**
 * Idempotent demo seed of healthcare facilities (name + region + district).
 * Inserts only rows that are not already present.
 * Call from seed entrypoint when desired — safe to re-run.
 */
export async function seedHealthcareFacilities(
  db: Db,
): Promise<SeedHealthcareFacilitiesResult> {
  const names = HEALTHCARE_FACILITY_SEEDS.map((row) => row.name)
  const existing = await db
    .select({
      name: healthcareFacilities.name,
      region: healthcareFacilities.region,
      district: healthcareFacilities.district,
    })
    .from(healthcareFacilities)
    .where(inArray(healthcareFacilities.name, names))

  const existingKeys = new Set(
    (existing ?? [])
      .filter((row) => Boolean(row?.name) && Boolean(row?.region) && Boolean(row?.district))
      .map((row) =>
        seedKey({
          name: row.name,
          region: row.region,
          district: row.district,
        }),
      ),
  )

  const toInsert = HEALTHCARE_FACILITY_SEEDS.filter(
    (row) => !existingKeys.has(seedKey(row)),
  )

  if (toInsert.length > 0) {
    await db.insert(healthcareFacilities).values([...toInsert])
  }

  return {
    inserted: toInsert.length,
    skipped: HEALTHCARE_FACILITY_SEEDS.length - toInsert.length,
    names,
  }
}

/**
 * Lookup helper for tests / dependent seeds — match by name + region + district.
 */
export async function findSeededFacilityId(
  db: Db,
  seed: Pick<HealthcareFacilitySeed, 'name' | 'region' | 'district'>,
): Promise<number | null> {
  const rows = await db
    .select({ id: healthcareFacilities.id })
    .from(healthcareFacilities)
    .where(
      and(
        eq(healthcareFacilities.name, seed.name),
        eq(healthcareFacilities.region, seed.region),
        eq(healthcareFacilities.district, seed.district),
      ),
    )
    .limit(1)

  const id = rows?.[0]?.id
  return typeof id === 'number' && Number.isFinite(id) ? id : null
}
