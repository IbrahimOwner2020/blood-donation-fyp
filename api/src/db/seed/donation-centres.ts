/**
 * Idempotent seed of demo donation centres (docs/06 donation_centres).
 * Inserts only name+region pairs that are not already present.
 */

import { inArray } from 'drizzle-orm'

import type { Db } from '../client'
import { donationCentres } from '../schema'
import {
  DONATION_CENTRE_SEEDS,
  type DonationCentreSeed,
} from './donation-centres-data'

export interface SeedDonationCentresResult {
  inserted: number
  skipped: number
  names: string[]
}

function seedKey(row: Pick<DonationCentreSeed, 'name' | 'region'>): string {
  return `${row.name.trim().toLowerCase()}|${row.region.trim().toLowerCase()}`
}

/**
 * Seed a few active demo centres for donation recording workflows.
 * Safe to re-run; never updates existing rows.
 */
export async function seedDonationCentres(
  db: Db,
): Promise<SeedDonationCentresResult> {
  const names = DONATION_CENTRE_SEEDS.map((row) => row.name)
  const existing = await db
    .select({
      name: donationCentres.name,
      region: donationCentres.region,
    })
    .from(donationCentres)
    .where(inArray(donationCentres.name, names))

  const existingKeys = new Set(
    (existing ?? [])
      .filter((row) => Boolean(row?.name) && Boolean(row?.region))
      .map((row) =>
        seedKey({
          name: row.name,
          region: row.region,
        }),
      ),
  )

  const toInsert = DONATION_CENTRE_SEEDS.filter(
    (row) => !existingKeys.has(seedKey(row)),
  )

  if (toInsert.length > 0) {
    await db.insert(donationCentres).values(
      toInsert.map((row) => ({
        name: row.name,
        region: row.region,
        address: row.address ?? null,
        active: row.active ?? true,
      })),
    )
  }

  return {
    inserted: toInsert.length,
    skipped: DONATION_CENTRE_SEEDS.length - toInsert.length,
    names,
  }
}
