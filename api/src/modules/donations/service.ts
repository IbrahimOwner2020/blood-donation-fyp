/**
 * Donation persistence — record donation + linked inventory units in one txn
 * (docs/04, docs/06 unit-linked blood_inventory; TODO.md §4).
 */

import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  lte,
  type SQL,
} from 'drizzle-orm'

import type { Db, DbTransaction } from '../../db'
import { withTransaction } from '../../db'
import {
  bloodGroups,
  bloodInventory,
  donationCentres,
  donations,
  donors,
  healthcareFacilities,
} from '../../db/schema'
import { AppError } from '../../lib/errors'
import type {
  CreateDonationBody,
  ListDonationsQuery,
  UpdateDonationBody,
} from './schemas'
import {
  toPublicDonation,
  type BloodGroupRow,
  type CentreSummaryRow,
  type DonationRow,
  type DonorSummaryRow,
  type PublicDonation,
} from './serialize'
import { computeExpiryDate } from './shelf-life'

type Executor = Db | DbTransaction

type DonationLoaded = {
  donation: DonationRow
  bloodGroup: BloodGroupRow | null
  donor: DonorSummaryRow | null
  centre: CentreSummaryRow | null
}

function mapDonationRow(row: typeof donations.$inferSelect): DonationRow {
  return {
    id: row.id,
    donorId: row.donorId,
    donationCentreId: row.donationCentreId,
    bloodGroupId: row.bloodGroupId,
    donationDate: row.donationDate,
    units: row.units,
    notes: row.notes ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
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

function mapDonorSummary(
  row: typeof donors.$inferSelect | null | undefined,
): DonorSummaryRow | null {
  if (!row?.id) {
    return null
  }
  return {
    id: row.id,
    donorNumber: row.donorNumber,
    firstName: row.firstName,
    lastName: row.lastName,
  }
}

function mapCentreSummary(
  row: typeof donationCentres.$inferSelect | null | undefined,
): CentreSummaryRow | null {
  if (!row?.id) {
    return null
  }
  return {
    id: row.id,
    name: row.name,
    region: row.region,
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
  db: Executor,
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
  db: Executor,
  code: string,
): Promise<BloodGroupRow | null> {
  const rows = await db
    .select()
    .from(bloodGroups)
    .where(eq(bloodGroups.code, code))
    .limit(1)
  return mapBloodGroupRow(rows?.[0])
}

async function requireActiveDonor(
  db: Executor,
  donorId: number,
): Promise<{
  id: number
  bloodGroupId: number
  active: boolean
  summary: DonorSummaryRow
}> {
  const rows = await db
    .select()
    .from(donors)
    .where(eq(donors.id, donorId))
    .limit(1)

  const row = rows?.[0]
  if (!row?.id) {
    throw AppError.validation('Invalid donor', [
      {
        path: 'donorId',
        message: 'Donor does not exist',
        code: 'invalid_donor',
      },
    ])
  }

  if (!row.active) {
    throw AppError.validation('Donor is inactive', [
      {
        path: 'donorId',
        message: 'Donor is inactive and cannot donate',
        code: 'inactive_donor',
      },
    ])
  }

  const summary = mapDonorSummary(row)
  if (!summary) {
    throw AppError.internal('Failed to map donor')
  }

  return {
    id: row.id,
    bloodGroupId: row.bloodGroupId,
    active: Boolean(row.active),
    summary,
  }
}

async function requireActiveCentre(
  db: Executor,
  centreId: number,
): Promise<CentreSummaryRow> {
  const rows = await db
    .select()
    .from(donationCentres)
    .where(eq(donationCentres.id, centreId))
    .limit(1)

  const row = rows?.[0]
  if (!row?.id) {
    throw AppError.validation('Invalid donation centre', [
      {
        path: 'donationCentreId',
        message: 'Donation centre does not exist',
        code: 'invalid_donation_centre',
      },
    ])
  }

  if (!row.active) {
    throw AppError.validation('Donation centre is inactive', [
      {
        path: 'donationCentreId',
        message: 'Donation centre is inactive',
        code: 'inactive_donation_centre',
      },
    ])
  }

  const summary = mapCentreSummary(row)
  if (!summary) {
    throw AppError.internal('Failed to map donation centre')
  }
  return summary
}

async function requireFacilityIfProvided(
  db: Executor,
  facilityId: number | null | undefined,
): Promise<number | null> {
  if (facilityId === undefined || facilityId === null) {
    return null
  }

  const rows = await db
    .select({ id: healthcareFacilities.id, active: healthcareFacilities.active })
    .from(healthcareFacilities)
    .where(eq(healthcareFacilities.id, facilityId))
    .limit(1)

  const facility = rows?.[0]
  if (!facility?.id) {
    throw AppError.validation('Invalid facility', [
      {
        path: 'facilityId',
        message: 'Facility does not exist',
        code: 'invalid_facility',
      },
    ])
  }

  if (!facility.active) {
    throw AppError.validation('Facility is inactive', [
      {
        path: 'facilityId',
        message: 'Facility is inactive',
        code: 'inactive_facility',
      },
    ])
  }

  return facility.id
}

async function loadDonation(
  db: Executor,
  donationId: number,
): Promise<DonationLoaded | null> {
  const rows = await db
    .select({
      donation: donations,
      bloodGroup: bloodGroups,
      donor: donors,
      centre: donationCentres,
    })
    .from(donations)
    .leftJoin(bloodGroups, eq(donations.bloodGroupId, bloodGroups.id))
    .leftJoin(donors, eq(donations.donorId, donors.id))
    .leftJoin(
      donationCentres,
      eq(donations.donationCentreId, donationCentres.id),
    )
    .where(eq(donations.id, donationId))
    .limit(1)

  const match = rows?.[0]
  if (!match?.donation?.id) {
    return null
  }

  return {
    donation: mapDonationRow(match.donation),
    bloodGroup: mapBloodGroupRow(match.bloodGroup),
    donor: mapDonorSummary(match.donor),
    centre: mapCentreSummary(match.centre),
  }
}

async function countInventoryForDonation(
  db: Executor,
  donationId: number,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(bloodInventory)
    .where(eq(bloodInventory.donationId, donationId))

  return Number(row?.value ?? 0)
}

function toPublicOrThrow(
  loaded: DonationLoaded | null,
  options: { inventoryUnitCount?: number; inventoryUnitIds?: number[] } = {},
): PublicDonation {
  const publicDonation = toPublicDonation(
    loaded?.donation,
    {
      bloodGroup: loaded?.bloodGroup,
      donor: loaded?.donor,
      centre: loaded?.centre,
    },
    options,
  )
  if (!publicDonation) {
    throw AppError.internal('Failed to serialize donation')
  }
  return publicDonation
}

function buildListConditions(
  filters: ListDonationsQuery,
  resolvedBloodGroupId?: number,
  db?: Db,
): SQL | undefined {
  const parts: SQL[] = []

  if (typeof filters.donorId === 'number') {
    parts.push(eq(donations.donorId, filters.donorId))
  }
  if (typeof filters.donationCentreId === 'number') {
    parts.push(eq(donations.donationCentreId, filters.donationCentreId))
  }
  if (typeof filters.facilityId === 'number' && db) {
    parts.push(
      inArray(
        donations.id,
        db
          .select({ donationId: bloodInventory.donationId })
          .from(bloodInventory)
          .where(eq(bloodInventory.facilityId, filters.facilityId)),
      ),
    )
  }
  if (typeof resolvedBloodGroupId === 'number') {
    parts.push(eq(donations.bloodGroupId, resolvedBloodGroupId))
  }
  if (filters.from) {
    parts.push(gte(donations.donationDate, filters.from))
  }
  if (filters.to) {
    parts.push(lte(donations.donationDate, filters.to))
  }

  if (parts.length === 0) {
    return undefined
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return and(...parts)
}

export type ListDonationsResult = {
  items: PublicDonation[]
  total: number
  limit: number
  offset: number
}

export async function listDonations(
  db: Db,
  query: ListDonationsQuery,
): Promise<ListDonationsResult> {
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
    .from(donations)
    .where(whereClause)

  const total = Number(totalRow?.value ?? 0)

  const rows = await db
    .select({
      donation: donations,
      bloodGroup: bloodGroups,
      donor: donors,
      centre: donationCentres,
    })
    .from(donations)
    .leftJoin(bloodGroups, eq(donations.bloodGroupId, bloodGroups.id))
    .leftJoin(donors, eq(donations.donorId, donors.id))
    .leftJoin(
      donationCentres,
      eq(donations.donationCentreId, donationCentres.id),
    )
    .where(whereClause)
    .orderBy(asc(donations.donationDate), asc(donations.id))
    .limit(limit)
    .offset(offset)

  const items = (rows ?? [])
    .map((row) =>
      toPublicDonation(row?.donation ? mapDonationRow(row.donation) : null, {
        bloodGroup: mapBloodGroupRow(row?.bloodGroup),
        donor: mapDonorSummary(row?.donor),
        centre: mapCentreSummary(row?.centre),
      }),
    )
    .filter((item): item is PublicDonation => item !== null)

  return { items, total, limit, offset }
}

export async function getDonationById(
  db: Executor,
  donationId: number,
  options: { facilityId?: number } = {},
): Promise<PublicDonation> {
  const loaded = await loadDonation(db, donationId)
  if (!loaded) {
    throw AppError.notFound('Donation not found')
  }
  if (typeof options.facilityId === 'number') {
    const [row] = await db
      .select({ value: count() })
      .from(bloodInventory)
      .where(
        and(
          eq(bloodInventory.donationId, donationId),
          eq(bloodInventory.facilityId, options.facilityId),
        ),
      )
    if (Number(row?.value ?? 0) === 0) {
      throw AppError.notFound('Donation not found')
    }
  }
  const inventoryUnitCount = await countInventoryForDonation(db, donationId)
  return toPublicOrThrow(loaded, { inventoryUnitCount })
}

/**
 * Insert one donation row and `units` AVAILABLE inventory unit rows atomically.
 */
export async function createDonation(
  db: Db,
  body: CreateDonationBody,
  createdByUserId: number,
): Promise<PublicDonation> {
  if (
    typeof createdByUserId !== 'number' ||
    !Number.isFinite(createdByUserId) ||
    createdByUserId <= 0
  ) {
    throw AppError.unauthorized('Authentication required to record a donation')
  }

  const units = body.units ?? 1
  const notes = emptyToNull(body.notes ?? null)
  const donationDate = body.donationDate
  const expiryDate = computeExpiryDate(donationDate)

  return withTransaction(db, async (tx) => {
    const donor = await requireActiveDonor(tx, body.donorId)
    const centre = await requireActiveCentre(tx, body.donationCentreId)
    const bloodGroup = await requireBloodGroup(tx, body.bloodGroupId)
    const facilityId = await requireFacilityIfProvided(tx, body.facilityId)

    if (donor.bloodGroupId !== bloodGroup.id) {
      throw AppError.validation(
        'Blood group must match the donor registered group',
        [
          {
            path: 'bloodGroupId',
            message: 'Blood group does not match donor blood group',
            code: 'blood_group_mismatch',
          },
        ],
      )
    }

    const inserted = await tx
      .insert(donations)
      .values({
        donorId: donor.id,
        donationCentreId: centre.id,
        bloodGroupId: bloodGroup.id,
        donationDate,
        units,
        notes,
        createdBy: createdByUserId,
      })
      .$returningId()

    const donationId = inserted?.[0]?.id
    if (typeof donationId !== 'number' || !Number.isFinite(donationId)) {
      throw AppError.internal('Failed to create donation')
    }

    const inventoryValues = Array.from({ length: units }, () => ({
      donationId,
      bloodGroupId: bloodGroup.id,
      collectionDate: donationDate,
      expiryDate,
      status: 'AVAILABLE' as const,
      facilityId,
    }))

    const inventoryInserted = await tx
      .insert(bloodInventory)
      .values(inventoryValues)
      .$returningId()

    const inventoryUnitIds = (inventoryInserted ?? [])
      .map((row) => row?.id)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))

    if (inventoryUnitIds.length !== units) {
      throw AppError.internal('Failed to create inventory units for donation')
    }

    const loaded = await loadDonation(tx, donationId)
    return toPublicOrThrow(loaded, {
      inventoryUnitCount: inventoryUnitIds.length,
      inventoryUnitIds,
    })
  })
}

export async function updateDonation(
  db: Db,
  donationId: number,
  body: UpdateDonationBody,
): Promise<PublicDonation> {
  const existing = await loadDonation(db, donationId)
  if (!existing) {
    throw AppError.notFound('Donation not found')
  }

  const patch: {
    notes?: string | null
    donationCentreId?: number
  } = {}

  if (body.notes !== undefined) {
    patch.notes = emptyToNull(body.notes)
  }

  if (typeof body.donationCentreId === 'number') {
    const centre = await requireActiveCentre(db, body.donationCentreId)
    patch.donationCentreId = centre.id
  }

  if (Object.keys(patch).length === 0) {
    throw AppError.validation('At least one field is required')
  }

  await db.update(donations).set(patch).where(eq(donations.id, donationId))

  return getDonationById(db, donationId)
}
