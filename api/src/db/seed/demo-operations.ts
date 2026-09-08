/**
 * Idempotent demo operational seed for local/QA (docs DoD browser path).
 * Creates donors, donations + inventory units, blood requests, and demand history.
 * Skips predictions/alerts (run forecast from UI after demand history exists).
 *
 * Prerequisites: blood groups, centres, facilities seeded; at least one ACTIVE user
 * (prefer demo officer/admin from SEED_DEMO_USERS).
 */

import { and, eq, inArray } from 'drizzle-orm'

import { computeExpiryDate } from '../../modules/donations/shelf-life'
import type { Db } from '../client'
import {
  bloodGroups,
  bloodInventory,
  bloodRequests,
  demandRecords,
  donationCentres,
  donations,
  donors,
  healthcareFacilities,
  users,
} from '../schema'
import {
  DEMO_BLOOD_REQUEST_SEEDS,
  DEMO_DEMAND_SERIES_SEEDS,
  DEMO_DONATION_SEEDS,
  DEMO_DONOR_SEEDS,
  demoDonationNotes,
  type DemoBloodRequestSeed,
  type DemoDemandSeriesSeed,
  type DemoDonorSeed,
} from './demo-operations-data'

export interface SeedDemoOperationsResult {
  donorsInserted: number
  donorsSkipped: number
  donationsInserted: number
  donationsSkipped: number
  inventoryUnitsInserted: number
  requestsInserted: number
  requestsSkipped: number
  demandInserted: number
  demandSkipped: number
  donorNumbers: string[]
  requestKeys: string[]
  actorUserId: number | null
  warnings: string[]
}

function utcDateOnly(offsetDays = 0, from: Date = new Date()): string {
  const utc = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  )
  utc.setUTCDate(utc.getUTCDate() + offsetDays)
  const y = utc.getUTCFullYear()
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0')
  const d = String(utc.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function utcTimestamp(offsetDays = 0, from: Date = new Date()): Date {
  const utc = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      10,
      0,
      0,
    ),
  )
  utc.setUTCDate(utc.getUTCDate() + offsetDays)
  return utc
}

function demandDayKey(
  date: string,
  bloodGroupId: number,
  facilityId: number | null,
): string {
  return `${date}|${bloodGroupId}|${facilityId ?? 'null'}`
}

function requestMatchKey(seed: DemoBloodRequestSeed): string {
  return [
    seed.facilityName.trim().toLowerCase(),
    seed.bloodGroupCode.trim().toUpperCase(),
    seed.status,
    String(seed.unitsRequested),
  ].join('|')
}

function existingRequestMatchKey(row: {
  facilityName: string
  bloodGroupCode: string
  status: string
  unitsRequested: number
}): string {
  return [
    row.facilityName.trim().toLowerCase(),
    row.bloodGroupCode.trim().toUpperCase(),
    row.status,
    String(row.unitsRequested),
  ].join('|')
}

/** Prefer demo officer, then demo admin, then any ACTIVE user. */
async function resolveActorUserId(db: Db): Promise<number | null> {
  const preferredEmails = [
    process.env?.DEMO_OFFICER_EMAIL?.trim() || 'officer@nbts.local',
    process.env?.DEMO_ADMIN_EMAIL?.trim() || 'admin@nbts.local',
  ]

  const preferred = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.status, 'ACTIVE'), inArray(users.email, preferredEmails)))

  const byEmail = new Map(
    (preferred ?? [])
      .filter(
        (row): row is { id: number; email: string } =>
          typeof row?.id === 'number' && typeof row?.email === 'string',
      )
      .map((row) => [row.email, row.id] as const),
  )

  for (const email of preferredEmails) {
    const id = byEmail.get(email)
    if (typeof id === 'number') {
      return id
    }
  }

  const fallback = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.status, 'ACTIVE'))
    .limit(1)

  const id = fallback?.[0]?.id
  return typeof id === 'number' && Number.isFinite(id) ? id : null
}

async function loadBloodGroupIds(db: Db): Promise<Map<string, number>> {
  const codes = [
    ...new Set([
      ...DEMO_DONOR_SEEDS.map((row) => row.bloodGroupCode),
      ...DEMO_BLOOD_REQUEST_SEEDS.map((row) => row.bloodGroupCode),
      ...DEMO_DEMAND_SERIES_SEEDS.map((row) => row.bloodGroupCode),
    ]),
  ]
  const rows = await db
    .select({ id: bloodGroups.id, code: bloodGroups.code })
    .from(bloodGroups)
    .where(inArray(bloodGroups.code, codes))

  const map = new Map<string, number>()
  for (const row of rows ?? []) {
    if (row?.code != null && typeof row?.id === 'number') {
      map.set(row.code, row.id)
    }
  }
  return map
}

async function loadCentreIdsByName(db: Db): Promise<Map<string, number>> {
  const names = [...new Set(DEMO_DONATION_SEEDS.map((row) => row.centreName))]
  const rows = await db
    .select({ id: donationCentres.id, name: donationCentres.name })
    .from(donationCentres)
    .where(inArray(donationCentres.name, names))

  const map = new Map<string, number>()
  for (const row of rows ?? []) {
    if (row?.name != null && typeof row?.id === 'number') {
      map.set(row.name, row.id)
    }
  }
  return map
}

async function loadFacilityIdsByName(db: Db): Promise<Map<string, number>> {
  const names = [
    ...new Set(
      [
        ...DEMO_DONATION_SEEDS.map((row) => row.facilityName),
        ...DEMO_BLOOD_REQUEST_SEEDS.map((row) => row.facilityName),
        ...DEMO_DEMAND_SERIES_SEEDS.map((row) => row.facilityName),
      ].filter((name): name is string => typeof name === 'string' && name.length > 0),
    ),
  ]
  if (names.length === 0) {
    return new Map()
  }

  const rows = await db
    .select({ id: healthcareFacilities.id, name: healthcareFacilities.name })
    .from(healthcareFacilities)
    .where(inArray(healthcareFacilities.name, names))

  const map = new Map<string, number>()
  for (const row of rows ?? []) {
    if (row?.name != null && typeof row?.id === 'number') {
      map.set(row.name, row.id)
    }
  }
  return map
}

async function seedDonors(
  db: Db,
  bloodGroupIdByCode: Map<string, number>,
  warnings: string[],
): Promise<{
  inserted: number
  skipped: number
  donorIdByNumber: Map<string, number>
}> {
  const donorNumbers = DEMO_DONOR_SEEDS.map((row) => row.donorNumber)
  const existing = await db
    .select({ id: donors.id, donorNumber: donors.donorNumber })
    .from(donors)
    .where(inArray(donors.donorNumber, donorNumbers))

  const donorIdByNumber = new Map<string, number>()
  for (const row of existing ?? []) {
    if (row?.donorNumber != null && typeof row?.id === 'number') {
      donorIdByNumber.set(row.donorNumber, row.id)
    }
  }

  let inserted = 0
  let skipped = 0

  for (const seed of DEMO_DONOR_SEEDS) {
    if (donorIdByNumber.has(seed.donorNumber)) {
      skipped += 1
      continue
    }

    const bloodGroupId = bloodGroupIdByCode.get(seed.bloodGroupCode)
    if (typeof bloodGroupId !== 'number') {
      warnings.push(
        `Donor ${seed.donorNumber}: blood group ${seed.bloodGroupCode} missing — run blood_groups seed first`,
      )
      continue
    }

    await db.insert(donors).values({
      donorNumber: seed.donorNumber,
      firstName: seed.firstName,
      lastName: seed.lastName,
      phone: seed.phone,
      email: seed.email,
      bloodGroupId,
      eligibilityStatus: 'POTENTIALLY_ELIGIBLE',
      active: true,
    })

    const created = await db
      .select({ id: donors.id })
      .from(donors)
      .where(eq(donors.donorNumber, seed.donorNumber))
      .limit(1)

    const id = created?.[0]?.id
    if (typeof id !== 'number') {
      warnings.push(`Donor ${seed.donorNumber}: insert failed to reload`)
      continue
    }

    donorIdByNumber.set(seed.donorNumber, id)
    inserted += 1
  }

  return { inserted, skipped, donorIdByNumber }
}

async function seedDonationsAndInventory(
  db: Db,
  actorUserId: number,
  donorIdByNumber: Map<string, number>,
  bloodGroupIdByCode: Map<string, number>,
  centreIdByName: Map<string, number>,
  facilityIdByName: Map<string, number>,
  warnings: string[],
): Promise<{
  donationsInserted: number
  donationsSkipped: number
  inventoryUnitsInserted: number
}> {
  const notesKeys = DEMO_DONATION_SEEDS.map((row) => demoDonationNotes(row.notesKey))
  const existing = await db
    .select({ id: donations.id, notes: donations.notes })
    .from(donations)
    .where(inArray(donations.notes, notesKeys))

  const existingNotes = new Set(
    (existing ?? [])
      .map((row) => row?.notes)
      .filter((notes): notes is string => typeof notes === 'string'),
  )

  let donationsInserted = 0
  let donationsSkipped = 0
  let inventoryUnitsInserted = 0

  for (const seed of DEMO_DONATION_SEEDS) {
    const notes = demoDonationNotes(seed.notesKey)
    if (existingNotes.has(notes)) {
      donationsSkipped += 1
      continue
    }

    const donorId = donorIdByNumber.get(seed.donorNumber)
    const donorSeed = DEMO_DONOR_SEEDS.find(
      (row: DemoDonorSeed) => row.donorNumber === seed.donorNumber,
    )
    const bloodGroupId =
      donorSeed != null
        ? bloodGroupIdByCode.get(donorSeed.bloodGroupCode)
        : undefined
    const centreId = centreIdByName.get(seed.centreName)
    const facilityId =
      seed.facilityName != null
        ? facilityIdByName.get(seed.facilityName)
        : null

    if (typeof donorId !== 'number') {
      warnings.push(
        `Donation ${seed.notesKey}: donor ${seed.donorNumber} missing`,
      )
      continue
    }
    if (typeof bloodGroupId !== 'number') {
      warnings.push(`Donation ${seed.notesKey}: blood group missing`)
      continue
    }
    if (typeof centreId !== 'number') {
      warnings.push(
        `Donation ${seed.notesKey}: centre "${seed.centreName}" missing`,
      )
      continue
    }
    if (seed.facilityName != null && typeof facilityId !== 'number') {
      warnings.push(
        `Donation ${seed.notesKey}: facility "${seed.facilityName}" missing`,
      )
      continue
    }

    const donationDate = utcDateOnly(seed.donationDateOffsetDays)
    const expiryDate = computeExpiryDate(donationDate)
    const units = seed.units > 0 ? seed.units : 1

    const inserted = await db
      .insert(donations)
      .values({
        donorId,
        donationCentreId: centreId,
        bloodGroupId,
        donationDate,
        units,
        notes,
        createdBy: actorUserId,
      })
      .$returningId()

    const donationId = inserted?.[0]?.id
    if (typeof donationId !== 'number') {
      warnings.push(`Donation ${seed.notesKey}: insert failed`)
      continue
    }

    const inventoryValues = Array.from({ length: units }, () => ({
      donationId,
      bloodGroupId,
      collectionDate: donationDate,
      expiryDate,
      status: 'AVAILABLE' as const,
      facilityId: typeof facilityId === 'number' ? facilityId : null,
    }))

    await db.insert(bloodInventory).values(inventoryValues)
    donationsInserted += 1
    inventoryUnitsInserted += units
    existingNotes.add(notes)
  }

  return { donationsInserted, donationsSkipped, inventoryUnitsInserted }
}

async function seedBloodRequests(
  db: Db,
  actorUserId: number,
  bloodGroupIdByCode: Map<string, number>,
  facilityIdByName: Map<string, number>,
  warnings: string[],
): Promise<{ inserted: number; skipped: number }> {
  const facilityNames = [
    ...new Set(DEMO_BLOOD_REQUEST_SEEDS.map((row) => row.facilityName)),
  ]
  const existingRows = await db
    .select({
      facilityId: bloodRequests.facilityId,
      bloodGroupId: bloodRequests.bloodGroupId,
      status: bloodRequests.status,
      unitsRequested: bloodRequests.unitsRequested,
      facilityName: healthcareFacilities.name,
      bloodGroupCode: bloodGroups.code,
    })
    .from(bloodRequests)
    .innerJoin(
      healthcareFacilities,
      eq(bloodRequests.facilityId, healthcareFacilities.id),
    )
    .innerJoin(bloodGroups, eq(bloodRequests.bloodGroupId, bloodGroups.id))
    .where(inArray(healthcareFacilities.name, facilityNames))

  const existingKeys = new Set(
    (existingRows ?? [])
      .filter(
        (
          row,
        ): row is {
          facilityId: number
          bloodGroupId: number
          status: string
          unitsRequested: number
          facilityName: string
          bloodGroupCode: string
        } =>
          typeof row?.facilityName === 'string' &&
          typeof row?.bloodGroupCode === 'string' &&
          typeof row?.status === 'string' &&
          typeof row?.unitsRequested === 'number',
      )
      .map((row) =>
        existingRequestMatchKey({
          facilityName: row.facilityName,
          bloodGroupCode: row.bloodGroupCode,
          status: row.status,
          unitsRequested: row.unitsRequested,
        }),
      ),
  )

  let inserted = 0
  let skipped = 0

  for (const seed of DEMO_BLOOD_REQUEST_SEEDS) {
    const key = requestMatchKey(seed)
    if (existingKeys.has(key)) {
      skipped += 1
      continue
    }

    const facilityId = facilityIdByName.get(seed.facilityName)
    const bloodGroupId = bloodGroupIdByCode.get(seed.bloodGroupCode)
    if (typeof facilityId !== 'number') {
      warnings.push(
        `Request ${seed.requestKey}: facility "${seed.facilityName}" missing`,
      )
      continue
    }
    if (typeof bloodGroupId !== 'number') {
      warnings.push(
        `Request ${seed.requestKey}: blood group ${seed.bloodGroupCode} missing`,
      )
      continue
    }

    const requiredAt =
      typeof seed.requiredAtOffsetDays === 'number'
        ? utcTimestamp(seed.requiredAtOffsetDays)
        : null

    await db.insert(bloodRequests).values({
      facilityId,
      bloodGroupId,
      unitsRequested: seed.unitsRequested,
      priority: seed.priority,
      requestedAt: utcTimestamp(-1),
      requiredAt,
      status: seed.status,
      fulfilledUnits: seed.fulfilledUnits,
      createdBy: actorUserId,
    })

    existingKeys.add(key)
    inserted += 1
  }

  return { inserted, skipped }
}

/**
 * Mild weekday-ish variation so series is not flat (helps forecast UI).
 */
function unitsForDemandDay(
  seed: DemoDemandSeriesSeed,
  dayIndexFromOldest: number,
): { unitsRequested: number; unitsIssued: number; unfulfilledUnits: number } {
  const wave = (dayIndexFromOldest % 7) - 3
  const unitsRequested = Math.max(1, seed.baseUnitsRequested + wave)
  const unitsIssued = Math.max(0, unitsRequested - (dayIndexFromOldest % 3 === 0 ? 1 : 0))
  const unfulfilledUnits = Math.max(0, unitsRequested - unitsIssued)
  return { unitsRequested, unitsIssued, unfulfilledUnits }
}

async function seedDemandSeries(
  db: Db,
  bloodGroupIdByCode: Map<string, number>,
  facilityIdByName: Map<string, number>,
  warnings: string[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0
  let skipped = 0

  for (const seed of DEMO_DEMAND_SERIES_SEEDS) {
    const bloodGroupId = bloodGroupIdByCode.get(seed.bloodGroupCode)
    if (typeof bloodGroupId !== 'number') {
      warnings.push(
        `Demand ${seed.seriesKey}: blood group ${seed.bloodGroupCode} missing`,
      )
      continue
    }

    const facilityId =
      seed.facilityName != null
        ? facilityIdByName.get(seed.facilityName)
        : null
    if (seed.facilityName != null && typeof facilityId !== 'number') {
      warnings.push(
        `Demand ${seed.seriesKey}: facility "${seed.facilityName}" missing`,
      )
      continue
    }

    const dayCount = seed.dayCount > 0 ? seed.dayCount : 30
    const startOffset = -(dayCount - 1)
    const dates: string[] = []
    for (let offset = startOffset; offset <= 0; offset += 1) {
      dates.push(utcDateOnly(offset))
    }

    const existingQuery =
      typeof facilityId === 'number'
        ? await db
            .select({
              id: demandRecords.id,
              date: demandRecords.date,
              facilityId: demandRecords.facilityId,
              bloodGroupId: demandRecords.bloodGroupId,
            })
            .from(demandRecords)
            .where(
              and(
                eq(demandRecords.bloodGroupId, bloodGroupId),
                eq(demandRecords.facilityId, facilityId),
                eq(demandRecords.source, 'SYSTEM'),
                inArray(demandRecords.date, dates),
              ),
            )
        : await db
            .select({
              id: demandRecords.id,
              date: demandRecords.date,
              facilityId: demandRecords.facilityId,
              bloodGroupId: demandRecords.bloodGroupId,
            })
            .from(demandRecords)
            .where(
              and(
                eq(demandRecords.bloodGroupId, bloodGroupId),
                eq(demandRecords.source, 'SYSTEM'),
                inArray(demandRecords.date, dates),
              ),
            )

    const existingKeys = new Set<string>()
    for (const row of existingQuery ?? []) {
      const dateRaw = row?.date
      const date =
        typeof dateRaw === 'string'
          ? dateRaw.slice(0, 10)
          : dateRaw instanceof Date
            ? utcDateOnly(0, dateRaw)
            : null
      if (!date || typeof row?.bloodGroupId !== 'number') {
        continue
      }
      existingKeys.add(
        demandDayKey(
          date,
          row.bloodGroupId,
          typeof row.facilityId === 'number' ? row.facilityId : null,
        ),
      )
    }

    const toInsert: Array<{
      facilityId: number | null
      bloodGroupId: number
      date: string
      unitsRequested: number
      unitsIssued: number
      unitsUsed: null
      unfulfilledUnits: number
      source: 'SYSTEM'
    }> = []

    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i]
      if (date == null) {
        continue
      }
      const key = demandDayKey(
        date,
        bloodGroupId,
        typeof facilityId === 'number' ? facilityId : null,
      )
      if (existingKeys.has(key)) {
        skipped += 1
        continue
      }
      const units = unitsForDemandDay(seed, i)
      toInsert.push({
        facilityId: typeof facilityId === 'number' ? facilityId : null,
        bloodGroupId,
        date,
        unitsRequested: units.unitsRequested,
        unitsIssued: units.unitsIssued,
        unitsUsed: null,
        unfulfilledUnits: units.unfulfilledUnits,
        source: 'SYSTEM',
      })
      existingKeys.add(key)
    }

    if (toInsert.length > 0) {
      // Batch insert in chunks to avoid oversized packets.
      const chunkSize = 50
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize)
        await db.insert(demandRecords).values(chunk)
      }
      inserted += toInsert.length
    }
  }

  return { inserted, skipped }
}

/**
 * Seed demo operational rows for QA of donors, inventory, requests, forecasts.
 * Safe to re-run: keyed by donor numbers, donation notes markers, request soft-keys,
 * and demand (date + group + facility + SYSTEM).
 */
export async function seedDemoOperations(
  db: Db,
): Promise<SeedDemoOperationsResult> {
  const warnings: string[] = []
  const donorNumbers = DEMO_DONOR_SEEDS.map((row) => row.donorNumber)
  const requestKeys = DEMO_BLOOD_REQUEST_SEEDS.map((row) => row.requestKey)

  const actorUserId = await resolveActorUserId(db)
  if (actorUserId == null) {
    warnings.push(
      'No ACTIVE user found — donations/requests need createdBy. Enable SEED_DEMO_USERS or create a user first.',
    )
    return {
      donorsInserted: 0,
      donorsSkipped: 0,
      donationsInserted: 0,
      donationsSkipped: 0,
      inventoryUnitsInserted: 0,
      requestsInserted: 0,
      requestsSkipped: 0,
      demandInserted: 0,
      demandSkipped: 0,
      donorNumbers,
      requestKeys,
      actorUserId: null,
      warnings,
    }
  }

  const bloodGroupIdByCode = await loadBloodGroupIds(db)
  const centreIdByName = await loadCentreIdsByName(db)
  const facilityIdByName = await loadFacilityIdsByName(db)

  for (const code of [
    ...new Set([
      ...DEMO_DONOR_SEEDS.map((r) => r.bloodGroupCode),
      ...DEMO_BLOOD_REQUEST_SEEDS.map((r) => r.bloodGroupCode),
      ...DEMO_DEMAND_SERIES_SEEDS.map((r) => r.bloodGroupCode),
    ]),
  ]) {
    if (!bloodGroupIdByCode.has(code)) {
      warnings.push(`Blood group ${code} missing — run blood_groups seed first`)
    }
  }

  const donorsResult = await seedDonors(db, bloodGroupIdByCode, warnings)

  const donationsResult = await seedDonationsAndInventory(
    db,
    actorUserId,
    donorsResult.donorIdByNumber,
    bloodGroupIdByCode,
    centreIdByName,
    facilityIdByName,
    warnings,
  )

  const requestsResult = await seedBloodRequests(
    db,
    actorUserId,
    bloodGroupIdByCode,
    facilityIdByName,
    warnings,
  )

  const demandResult = await seedDemandSeries(
    db,
    bloodGroupIdByCode,
    facilityIdByName,
    warnings,
  )

  return {
    donorsInserted: donorsResult.inserted,
    donorsSkipped: donorsResult.skipped,
    donationsInserted: donationsResult.donationsInserted,
    donationsSkipped: donationsResult.donationsSkipped,
    inventoryUnitsInserted: donationsResult.inventoryUnitsInserted,
    requestsInserted: requestsResult.inserted,
    requestsSkipped: requestsResult.skipped,
    demandInserted: demandResult.inserted,
    demandSkipped: demandResult.skipped,
    donorNumbers,
    requestKeys,
    actorUserId,
    warnings,
  }
}
