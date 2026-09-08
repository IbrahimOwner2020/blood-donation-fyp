/**
 * Donor persistence helpers (CRUD + soft deactivate + list filters).
 * Soft-deactivate with active=false — never hard-delete historical donors.
 */

import {
  and,
  asc,
  count,
  eq,
  inArray,
  like,
  ne,
  or,
  type SQL,
} from 'drizzle-orm'

import type { Db } from '../../db'
import { bloodGroups, donations, donors } from '../../db/schema'
import type { DonorEligibilityStatus } from '../../db/schema/enums'
import { AppError } from '../../lib/errors'
import type { CreateDonorBody, ListDonorsQuery, UpdateDonorBody } from './schemas'
import {
  toPublicDonor,
  type BloodGroupRow,
  type DonorRow,
  type PublicDonor,
} from './serialize'

type DonorWithBloodGroup = {
  donor: DonorRow
  bloodGroup: BloodGroupRow | null
}

function mapDonorRow(row: typeof donors.$inferSelect): DonorRow {
  return {
    id: row.id,
    donorNumber: row.donorNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone ?? null,
    email: row.email ?? null,
    bloodGroupId: row.bloodGroupId,
    eligibilityStatus: row.eligibilityStatus,
    active: Boolean(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapBloodGroupRow(
  row: typeof bloodGroups.$inferSelect | null | undefined,
): BloodGroupRow | null {
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

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function requireBloodGroup(
  db: Db,
  bloodGroupId: number,
): Promise<BloodGroupRow> {
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

async function findBloodGroupByCode(
  db: Db,
  code: string,
): Promise<BloodGroupRow | null> {
  const rows = await db
    .select()
    .from(bloodGroups)
    .where(eq(bloodGroups.code, code))
    .limit(1)
  return mapBloodGroupRow(rows?.[0])
}

async function assertUniqueDonorFields(
  db: Db,
  fields: {
    donorNumber?: string
    phone?: string | null
    email?: string | null
  },
  excludeDonorId?: number,
): Promise<void> {
  if (fields.donorNumber) {
    const where =
      excludeDonorId !== undefined
        ? and(
            eq(donors.donorNumber, fields.donorNumber),
            ne(donors.id, excludeDonorId),
          )
        : eq(donors.donorNumber, fields.donorNumber)

    const rows = await db
      .select({ id: donors.id })
      .from(donors)
      .where(where)
      .limit(1)

    if (rows?.[0]?.id) {
      throw AppError.conflict('Donor number already exists', [
        {
          path: 'donorNumber',
          message: 'Donor number already exists',
          code: 'duplicate_donor_number',
        },
      ])
    }
  }

  const phone = emptyToNull(fields.phone)
  if (phone) {
    const where =
      excludeDonorId !== undefined
        ? and(eq(donors.phone, phone), ne(donors.id, excludeDonorId))
        : eq(donors.phone, phone)

    const rows = await db
      .select({ id: donors.id })
      .from(donors)
      .where(where)
      .limit(1)

    if (rows?.[0]?.id) {
      throw AppError.conflict('Phone already registered to another donor', [
        {
          path: 'phone',
          message: 'Phone already registered to another donor',
          code: 'duplicate_phone',
        },
      ])
    }
  }

  const email = emptyToNull(fields.email)
  if (email) {
    const where =
      excludeDonorId !== undefined
        ? and(eq(donors.email, email), ne(donors.id, excludeDonorId))
        : eq(donors.email, email)

    const rows = await db
      .select({ id: donors.id })
      .from(donors)
      .where(where)
      .limit(1)

    if (rows?.[0]?.id) {
      throw AppError.conflict('Email already registered to another donor', [
        {
          path: 'email',
          message: 'Email already registered to another donor',
          code: 'duplicate_email',
        },
      ])
    }
  }
}

async function loadDonorWithBloodGroup(
  db: Db,
  donorId: number,
): Promise<DonorWithBloodGroup | null> {
  const rows = await db
    .select({
      donor: donors,
      bloodGroup: bloodGroups,
    })
    .from(donors)
    .leftJoin(bloodGroups, eq(donors.bloodGroupId, bloodGroups.id))
    .where(eq(donors.id, donorId))
    .limit(1)

  const match = rows?.[0]
  if (!match?.donor?.id) {
    return null
  }

  return {
    donor: mapDonorRow(match.donor),
    bloodGroup: mapBloodGroupRow(match.bloodGroup),
  }
}

function toPublicOrThrow(loaded: DonorWithBloodGroup | null): PublicDonor {
  const publicDonor = toPublicDonor(loaded?.donor, loaded?.bloodGroup)
  if (!publicDonor) {
    throw AppError.internal('Failed to serialize donor')
  }
  return publicDonor
}

function buildListConditions(
  filters: ListDonorsQuery,
  resolvedBloodGroupId?: number,
  db?: Db,
): SQL | undefined {
  const parts: SQL[] = []

  if (typeof resolvedBloodGroupId === 'number') {
    parts.push(eq(donors.bloodGroupId, resolvedBloodGroupId))
  }

  if (typeof filters.donationCentreId === 'number' && db) {
    parts.push(
      inArray(
        donors.id,
        db
          .select({ donorId: donations.donorId })
          .from(donations)
          .where(eq(donations.donationCentreId, filters.donationCentreId)),
      ),
    )
  }

  if (typeof filters.active === 'boolean') {
    parts.push(eq(donors.active, filters.active))
  }

  if (filters.eligibilityStatus) {
    parts.push(eq(donors.eligibilityStatus, filters.eligibilityStatus))
  }

  const search = filters.q?.trim()
  if (search) {
    const pattern = `%${search.replace(/[%_\\]/g, '\\$&')}%`
    const searchClause = or(
      like(donors.donorNumber, pattern),
      like(donors.firstName, pattern),
      like(donors.lastName, pattern),
      like(donors.phone, pattern),
      like(donors.email, pattern),
    )
    if (searchClause) {
      parts.push(searchClause)
    }
  }

  if (parts.length === 0) {
    return undefined
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return and(...parts)
}

export type ListDonorsResult = {
  items: PublicDonor[]
  total: number
  limit: number
  offset: number
}

export async function listDonors(
  db: Db,
  query: ListDonorsQuery,
): Promise<ListDonorsResult> {
  const limit = query.limit ?? 50
  const offset = query.offset ?? 0

  let resolvedBloodGroupId = query.bloodGroupId
  if (query.bloodGroup && resolvedBloodGroupId === undefined) {
    const group = await findBloodGroupByCode(db, query.bloodGroup)
    if (!group) {
      return { items: [], total: 0, limit, offset }
    }
    resolvedBloodGroupId = group.id
  }

  const whereClause = buildListConditions(query, resolvedBloodGroupId, db)

  const [totalRow] = await db
    .select({ value: count() })
    .from(donors)
    .where(whereClause)

  const total = Number(totalRow?.value ?? 0)

  const rows = await db
    .select({
      donor: donors,
      bloodGroup: bloodGroups,
    })
    .from(donors)
    .leftJoin(bloodGroups, eq(donors.bloodGroupId, bloodGroups.id))
    .where(whereClause)
    .orderBy(asc(donors.id))
    .limit(limit)
    .offset(offset)

  const items = (rows ?? [])
    .map((row) =>
      toPublicDonor(
        row?.donor ? mapDonorRow(row.donor) : null,
        mapBloodGroupRow(row?.bloodGroup),
      ),
    )
    .filter((item): item is PublicDonor => item !== null)

  return { items, total, limit, offset }
}

export async function getDonorById(
  db: Db,
  donorId: number,
): Promise<PublicDonor> {
  const loaded = await loadDonorWithBloodGroup(db, donorId)
  if (!loaded) {
    throw AppError.notFound('Donor not found')
  }
  return toPublicOrThrow(loaded)
}

export async function createDonor(
  db: Db,
  body: CreateDonorBody,
): Promise<PublicDonor> {
  const bloodGroup = await requireBloodGroup(db, body.bloodGroupId)
  const phone = emptyToNull(body.phone ?? null)
  const email = emptyToNull(body.email ?? null)

  await assertUniqueDonorFields(db, {
    donorNumber: body.donorNumber,
    phone,
    email,
  })

  const inserted = await db
    .insert(donors)
    .values({
      donorNumber: body.donorNumber,
      firstName: body.firstName,
      lastName: body.lastName,
      phone,
      email,
      bloodGroupId: bloodGroup.id,
      eligibilityStatus: body.eligibilityStatus ?? 'UNKNOWN',
      active: body.active ?? true,
    })
    .$returningId()

  const insertId = inserted?.[0]?.id
  if (typeof insertId !== 'number' || !Number.isFinite(insertId)) {
    throw AppError.internal('Failed to create donor')
  }

  return getDonorById(db, insertId)
}

export async function updateDonor(
  db: Db,
  donorId: number,
  body: UpdateDonorBody,
): Promise<PublicDonor> {
  const existing = await loadDonorWithBloodGroup(db, donorId)
  if (!existing) {
    throw AppError.notFound('Donor not found')
  }

  const patch: {
    donorNumber?: string
    firstName?: string
    lastName?: string
    phone?: string | null
    email?: string | null
    bloodGroupId?: number
    eligibilityStatus?: DonorEligibilityStatus
    active?: boolean
  } = {}

  if (body.donorNumber !== undefined) {
    patch.donorNumber = body.donorNumber
  }
  if (body.firstName !== undefined) {
    patch.firstName = body.firstName
  }
  if (body.lastName !== undefined) {
    patch.lastName = body.lastName
  }
  if (body.phone !== undefined) {
    patch.phone = emptyToNull(body.phone)
  }
  if (body.email !== undefined) {
    patch.email = emptyToNull(body.email)
  }
  if (body.eligibilityStatus !== undefined) {
    patch.eligibilityStatus = body.eligibilityStatus
  }
  if (typeof body.active === 'boolean') {
    patch.active = body.active
  }
  if (typeof body.bloodGroupId === 'number') {
    const bloodGroup = await requireBloodGroup(db, body.bloodGroupId)
    patch.bloodGroupId = bloodGroup.id
  }

  if (Object.keys(patch).length === 0) {
    throw AppError.validation('At least one field is required')
  }

  await assertUniqueDonorFields(
    db,
    {
      donorNumber: patch.donorNumber,
      phone: patch.phone,
      email: patch.email,
    },
    donorId,
  )

  await db.update(donors).set(patch).where(eq(donors.id, donorId))

  return getDonorById(db, donorId)
}

/**
 * Soft-deactivate: sets active=false so donation/notification history is retained.
 */
export async function deactivateDonor(
  db: Db,
  donorId: number,
): Promise<PublicDonor> {
  const existing = await loadDonorWithBloodGroup(db, donorId)
  if (!existing) {
    throw AppError.notFound('Donor not found')
  }

  if (existing.donor.active === false) {
    return toPublicOrThrow(existing)
  }

  await db
    .update(donors)
    .set({ active: false })
    .where(eq(donors.id, donorId))

  return getDonorById(db, donorId)
}
