/**
 * Healthcare facilities data access (docs/06 healthcare_facilities; TODO.md §5).
 * Soft deactivation via `active` — no hard deletes.
 */

import { and, asc, eq, like, type SQL } from 'drizzle-orm'

import type { Db } from '../../db'
import { healthcareFacilities } from '../../db/schema'
import { AppError } from '../../lib/errors'
import type {
  CreateFacilityBody,
  ListFacilitiesQuery,
  PatchFacilityBody,
} from './schemas'
import {
  toPublicFacilities,
  toPublicFacility,
  type FacilityRow,
  type PublicFacility,
} from './serialize'

function mapRow(row: typeof healthcareFacilities.$inferSelect): FacilityRow {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    district: row.district,
    active: Boolean(row.active),
  }
}

/** Escape LIKE metacharacters so user `q` is treated as literal text. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function buildListConditions(filters: ListFacilitiesQuery): SQL | undefined {
  const parts: SQL[] = []

  const region = filters.region?.trim()
  if (region) {
    parts.push(eq(healthcareFacilities.region, region))
  }

  const district = filters.district?.trim()
  if (district) {
    parts.push(eq(healthcareFacilities.district, district))
  }

  if (typeof filters.active === 'boolean') {
    parts.push(eq(healthcareFacilities.active, filters.active))
  }

  const q = filters.q?.trim()
  if (q) {
    parts.push(like(healthcareFacilities.name, `%${escapeLikePattern(q)}%`))
  }

  if (parts.length === 0) {
    return undefined
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return and(...parts)
}

export async function listFacilities(
  db: Db,
  filters: ListFacilitiesQuery = {},
): Promise<PublicFacility[]> {
  const where = buildListConditions(filters)
  const query = db
    .select()
    .from(healthcareFacilities)
    .orderBy(asc(healthcareFacilities.name), asc(healthcareFacilities.id))

  const rows = where ? await query.where(where) : await query
  return toPublicFacilities((rows ?? []).map(mapRow))
}

export async function getFacilityById(
  db: Db,
  id: number,
): Promise<PublicFacility> {
  const rows = await db
    .select()
    .from(healthcareFacilities)
    .where(eq(healthcareFacilities.id, id))
    .limit(1)

  const publicFacility = toPublicFacility(rows?.[0] ? mapRow(rows[0]) : null)
  if (!publicFacility) {
    throw AppError.notFound('Facility not found')
  }
  return publicFacility
}

export async function createFacility(
  db: Db,
  body: CreateFacilityBody,
): Promise<PublicFacility> {
  const inserted = await db
    .insert(healthcareFacilities)
    .values({
      name: body.name.trim(),
      region: body.region.trim(),
      district: body.district.trim(),
      active: body.active ?? true,
    })
    .$returningId()

  const insertedId = inserted?.[0]?.id
  if (typeof insertedId !== 'number' || !Number.isFinite(insertedId)) {
    throw AppError.internal('Failed to create facility')
  }

  return getFacilityById(db, insertedId)
}

export type PatchFacilityResult = {
  facility: PublicFacility
  previous: PublicFacility
  patch: {
    name?: string
    region?: string
    district?: string
    active?: boolean
  }
}

export async function patchFacility(
  db: Db,
  id: number,
  body: PatchFacilityBody,
): Promise<PatchFacilityResult> {
  const previous = await getFacilityById(db, id)

  const patch: {
    name?: string
    region?: string
    district?: string
    active?: boolean
  } = {}

  if (body.name !== undefined) {
    patch.name = body.name.trim()
  }
  if (body.region !== undefined) {
    patch.region = body.region.trim()
  }
  if (body.district !== undefined) {
    patch.district = body.district.trim()
  }
  if (typeof body.active === 'boolean') {
    patch.active = body.active
  }

  if (Object.keys(patch).length === 0) {
    throw AppError.validation('At least one field is required')
  }

  await db
    .update(healthcareFacilities)
    .set(patch)
    .where(eq(healthcareFacilities.id, id))

  const facility = await getFacilityById(db, id)
  return { facility, previous, patch }
}
