/**
 * On-demand donor matching for shortage alerts (docs/08, TODO.md §7).
 *
 * Query only — never sends notifications. Authorized users review matches first.
 */

import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  ne,
  or,
  type SQL,
} from 'drizzle-orm'

import type { Db } from '../../db'
import { bloodGroups, donors } from '../../db/schema'
import { AppError } from '../../lib/errors'
import {
  toPublicDonor,
  type PublicDonor,
} from '../donors/serialize'
import {
  MATCHABLE_ELIGIBILITY_STATUSES,
  MATCH_DISCLAIMER,
} from './match-rules'
import type { ListAlertMatchesQuery } from './schemas'
import { getAlertById } from './service'
import type { PublicAlert } from './serialize'

type DonorRow = typeof donors.$inferSelect
type BloodGroupRow = typeof bloodGroups.$inferSelect

function mapDonorRow(row: DonorRow) {
  return {
    id: row.id,
    donorNumber: row.donorNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone ?? null,
    email: row.email ?? null,
    bloodGroupId: row.bloodGroupId,
    eligibilityStatus: row.eligibilityStatus,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapBloodGroupRow(row: BloodGroupRow | null | undefined) {
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

/**
 * SQL WHERE for matchable donors of a blood group.
 * Mirrors match-rules.ts: active + POTENTIALLY_ELIGIBLE + contact.
 */
export function buildMatchWhere(bloodGroupId: number): SQL {
  const phoneContact = and(
    isNotNull(donors.phone),
    ne(donors.phone, ''),
  )
  const emailContact = and(
    isNotNull(donors.email),
    ne(donors.email, ''),
  )
  const contactClause = or(phoneContact, emailContact)

  return and(
    eq(donors.bloodGroupId, bloodGroupId),
    eq(donors.active, true),
    inArray(donors.eligibilityStatus, [...MATCHABLE_ELIGIBILITY_STATUSES]),
    contactClause,
  ) as SQL
}

export type ListMatchesForBloodGroupResult = {
  items: PublicDonor[]
  total: number
  limit: number
  offset: number
  bloodGroupId: number
  disclaimer: string
}

/**
 * Count matchable donors for a blood group (hook / metrics — no PII).
 */
export async function countMatchesForBloodGroup(
  db: Db,
  bloodGroupId: number,
): Promise<number> {
  if (
    typeof bloodGroupId !== 'number' ||
    !Number.isFinite(bloodGroupId) ||
    bloodGroupId <= 0
  ) {
    return 0
  }

  const whereClause = buildMatchWhere(bloodGroupId)
  const [totalRow] = await db
    .select({ value: count() })
    .from(donors)
    .where(whereClause)

  return Number(totalRow?.value ?? 0)
}

/**
 * On-demand match query by blood group id.
 */
export async function listMatchesForBloodGroup(
  db: Db,
  bloodGroupId: number,
  query: ListAlertMatchesQuery = { limit: 50, offset: 0 },
): Promise<ListMatchesForBloodGroupResult> {
  if (
    typeof bloodGroupId !== 'number' ||
    !Number.isFinite(bloodGroupId) ||
    bloodGroupId <= 0
  ) {
    throw AppError.validation('Invalid blood group for matching', [
      {
        path: 'bloodGroupId',
        message: 'Blood group id must be a positive integer',
        code: 'invalid_blood_group',
      },
    ])
  }

  const limit = query.limit ?? 50
  const offset = query.offset ?? 0
  const whereClause = buildMatchWhere(bloodGroupId)

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

  return {
    items,
    total,
    limit,
    offset,
    bloodGroupId,
    disclaimer: MATCH_DISCLAIMER,
  }
}

export type ListMatchesForAlertResult = ListMatchesForBloodGroupResult & {
  alert: PublicAlert
}

/**
 * Load alert by id, then return on-demand donor matches for its blood group.
 */
export async function listMatchesForAlert(
  db: Db,
  alertId: number,
  query: ListAlertMatchesQuery = { limit: 50, offset: 0 },
): Promise<ListMatchesForAlertResult> {
  const alert = await getAlertById(db, alertId)
  const matches = await listMatchesForBloodGroup(
    db,
    alert.bloodGroupId,
    query,
  )

  return {
    ...matches,
    alert,
  }
}
