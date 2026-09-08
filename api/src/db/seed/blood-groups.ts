import { inArray } from 'drizzle-orm'

import type { Db } from '../client'
import { bloodGroups } from '../schema'
import { BLOOD_GROUP_SEEDS } from './blood-groups-data'

export interface SeedBloodGroupsResult {
    inserted: number
    skipped: number
    codes: string[]
}

/**
 * Idempotent seed of the eight blood groups (A± B± AB± O±).
 * Inserts only codes that are not already present.
 */
export async function seedBloodGroups(
    db: Db,
): Promise<SeedBloodGroupsResult> {
    const codes = BLOOD_GROUP_SEEDS.map((row) => row.code)
    const existing = await db
        .select({ code: bloodGroups.code })
        .from(bloodGroups)
        .where(inArray(bloodGroups.code, codes))

    const existingCodes = new Set(
        (existing ?? [])
            .map((row) => row?.code)
            .filter((code): code is string => Boolean(code)),
    )

    const toInsert = BLOOD_GROUP_SEEDS.filter(
        (row) => !existingCodes.has(row.code),
    )

    if (toInsert.length > 0) {
        await db.insert(bloodGroups).values([...toInsert])
    }

    return {
        inserted: toInsert.length,
        skipped: BLOOD_GROUP_SEEDS.length - toInsert.length,
        codes,
    }
}
