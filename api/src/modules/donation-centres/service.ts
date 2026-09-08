/**
 * Donation centres data access (docs/06 donation_centres; TODO.md §4).
 * Soft deactivation via `active` — no hard deletes.
 */

import { and, asc, eq, type SQL } from 'drizzle-orm'

import type { Db } from '../../db'
import { donationCentres } from '../../db/schema'
import { AppError } from '../../lib/errors'
import type {
  CreateDonationCentreBody,
  ListDonationCentresQuery,
  PatchDonationCentreBody,
} from './schemas'
import {
  toPublicDonationCentre,
  toPublicDonationCentreList,
  type DonationCentreRow,
  type PublicDonationCentre,
} from './serialize'

function mapRow(row: typeof donationCentres.$inferSelect): DonationCentreRow {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    address: row.address ?? null,
    active: Boolean(row.active),
  }
}

function buildListConditions(filters: ListDonationCentresQuery): SQL | undefined {
  const parts: SQL[] = []

  const region = filters.region?.trim()
  if (region) {
    parts.push(eq(donationCentres.region, region))
  }

  if (typeof filters.active === 'boolean') {
    parts.push(eq(donationCentres.active, filters.active))
  }

  if (parts.length === 0) {
    return undefined
  }
  if (parts.length === 1) {
    return parts[0] ?? undefined
  }
  return and(...parts)
}

export async function listDonationCentres(
  db: Db,
  filters: ListDonationCentresQuery = {},
): Promise<PublicDonationCentre[]> {
  const where = buildListConditions(filters)
  const query = db
    .select()
    .from(donationCentres)
    .orderBy(asc(donationCentres.region), asc(donationCentres.name))

  const rows = where ? await query.where(where) : await query
  return toPublicDonationCentreList((rows ?? []).map(mapRow))
}

export async function getDonationCentreById(
  db: Db,
  id: number,
): Promise<PublicDonationCentre> {
  const rows = await db
    .select()
    .from(donationCentres)
    .where(eq(donationCentres.id, id))
    .limit(1)

  const publicCentre = toPublicDonationCentre(rows?.[0] ? mapRow(rows[0]) : null)
  if (!publicCentre) {
    throw AppError.notFound('Donation centre not found')
  }
  return publicCentre
}

export async function createDonationCentre(
  db: Db,
  body: CreateDonationCentreBody,
): Promise<PublicDonationCentre> {
  const name = body.name.trim()
  const region = body.region.trim()
  const address =
    body.address === undefined || body.address === null
      ? null
      : body.address.trim() || null
  const active = body.active ?? true

  const inserted = await db
    .insert(donationCentres)
    .values({
      name,
      region,
      address,
      active,
    })
    .$returningId()

  const insertedId = inserted?.[0]?.id
  if (typeof insertedId !== 'number' || !Number.isFinite(insertedId)) {
    throw AppError.internal('Failed to create donation centre')
  }

  return getDonationCentreById(db, insertedId)
}

export async function patchDonationCentre(
  db: Db,
  id: number,
  body: PatchDonationCentreBody,
): Promise<PublicDonationCentre> {
  await getDonationCentreById(db, id)

  const patch: {
    name?: string
    region?: string
    address?: string | null
    active?: boolean
  } = {}

  if (body.name !== undefined) {
    patch.name = body.name.trim()
  }
  if (body.region !== undefined) {
    patch.region = body.region.trim()
  }
  if (body.address !== undefined) {
    patch.address =
      body.address === null ? null : body.address.trim() || null
  }
  if (typeof body.active === 'boolean') {
    patch.active = body.active
  }

  if (Object.keys(patch).length === 0) {
    throw AppError.validation('At least one field is required')
  }

  await db
    .update(donationCentres)
    .set(patch)
    .where(eq(donationCentres.id, id))

  return getDonationCentreById(db, id)
}
