/**
 * Idempotent demo operational seed for local/QA (docs DoD browser path).
 * Creates donors, donations + inventory units, blood requests, and demand history.
 * Skips predictions/alerts (run forecast from UI after demand history exists).
 *
 * Prerequisites: blood groups, centres, facilities seeded; at least one ACTIVE user
 * (prefer demo officer/admin from SEED_DEMO_USERS).
 */

import { and, eq, gte, inArray, lte } from 'drizzle-orm'

import { computeExpiryDate } from '../../modules/donations/shelf-life'
import type { Db } from '../client'
import {
  bloodGroups,
  bloodInventory,
  bloodRequests,
  aiAnalysisRuns,
  aiPredictions,
  demandRecords,
  donationCentres,
  donations,
  donors,
  healthcareFacilities,
  notifications,
  shortageAlerts,
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
import {
  DEMO_60_DAY_MARKER,
  DEMO_60_DAY_MODEL_NAME,
  generate60DayDemoDataset,
  parseDemoDataAnchor,
  type Generated60DayDataset,
} from './demo-operations-60-day'

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
  predictionsInserted: number
  predictionsSkipped: number
  alertsInserted: number
  alertsSkipped: number
  notificationsInserted: number
  notificationsSkipped: number
  aiAnalysisRunsInserted: number
  aiAnalysisRunsSkipped: number
  generatedAnchor: string
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
  const rows = await db
    .select({ id: donationCentres.id, name: donationCentres.name })
    .from(donationCentres)
    .where(eq(donationCentres.active, true))

  const map = new Map<string, number>()
  for (const row of rows ?? []) {
    if (row?.name != null && typeof row?.id === 'number') {
      map.set(row.name, row.id)
    }
  }
  return map
}

async function loadFacilityIdsByName(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: healthcareFacilities.id, name: healthcareFacilities.name })
    .from(healthcareFacilities)
    .where(eq(healthcareFacilities.active, true))

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

function timestampKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(0, 19)
}

function dateKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10)
}

async function seedGeneratedDonors(
  db: Db,
  dataset: Generated60DayDataset,
  bloodGroupIdByCode: Map<string, number>,
  warnings: string[],
): Promise<{ inserted: number; skipped: number; donorIdByNumber: Map<string, number> }> {
  const donorNumbers = dataset.donors.map((row) => row.donorNumber)
  const existing = await db
    .select({ id: donors.id, donorNumber: donors.donorNumber })
    .from(donors)
    .where(inArray(donors.donorNumber, donorNumbers))
  const donorIdByNumber = new Map(existing.map((row) => [row.donorNumber, row.id]))
  let inserted = 0

  for (const seed of dataset.donors) {
    if (donorIdByNumber.has(seed.donorNumber)) continue
    const bloodGroupId = bloodGroupIdByCode.get(seed.bloodGroupCode)
    if (!bloodGroupId) {
      warnings.push(`60-day donor ${seed.donorNumber}: blood group ${seed.bloodGroupCode} missing`)
      continue
    }
    const created = await db.insert(donors).values({
      donorNumber: seed.donorNumber,
      firstName: seed.firstName,
      lastName: seed.lastName,
      phone: seed.phone,
      email: seed.email,
      dateOfBirth: seed.dateOfBirth,
      sex: seed.sex,
      address: seed.address,
      weightKg: seed.weightKg,
      smsConsent: seed.smsConsent,
      emailConsent: seed.emailConsent,
      bloodGroupId,
      eligibilityStatus: seed.eligibilityStatus,
      active: seed.active,
      createdAt: seed.createdAt,
      updatedAt: seed.createdAt,
    }).$returningId()
    const id = created[0]?.id
    if (typeof id !== 'number') {
      warnings.push(`60-day donor ${seed.donorNumber}: insert failed`)
      continue
    }
    donorIdByNumber.set(seed.donorNumber, id)
    inserted += 1
  }

  return { inserted, skipped: dataset.donors.length - inserted, donorIdByNumber }
}

async function seedGeneratedDonations(
  db: Db,
  dataset: Generated60DayDataset,
  actorUserId: number,
  donorIdByNumber: Map<string, number>,
  bloodGroupIdByCode: Map<string, number>,
  centreIdByName: Map<string, number>,
  facilityIdByName: Map<string, number>,
  warnings: string[],
): Promise<{ inserted: number; skipped: number; inventoryInserted: number }> {
  const notes = dataset.donations.map((row) => row.notes)
  const existing = await db.select({ notes: donations.notes }).from(donations).where(inArray(donations.notes, notes))
  const existingNotes = new Set(existing.map((row) => row.notes).filter((value): value is string => Boolean(value)))
  let inserted = 0
  let inventoryInserted = 0

  for (const seed of dataset.donations) {
    if (existingNotes.has(seed.notes)) continue
    const donorId = donorIdByNumber.get(seed.donorNumber)
    const bloodGroupId = bloodGroupIdByCode.get(seed.bloodGroupCode)
    const donationCentreId = centreIdByName.get(seed.centreName)
    const facilityId = facilityIdByName.get(seed.facilityName)
    if (!donorId || !bloodGroupId || !donationCentreId || !facilityId) {
      warnings.push(`60-day donation ${seed.key}: a donor, group, centre, or facility dependency is missing`)
      continue
    }
    const created = await db.insert(donations).values({
      donorId,
      donationCentreId,
      bloodGroupId,
      donationDate: seed.donationDate,
      category: seed.category,
      weightKgAtDonation: seed.weightKgAtDonation,
      units: 1,
      notes: seed.notes,
      createdBy: actorUserId,
      createdAt: seed.createdAt,
    }).$returningId()
    const donationId = created[0]?.id
    if (!donationId) {
      warnings.push(`60-day donation ${seed.key}: insert failed`)
      continue
    }
    await db.insert(bloodInventory).values({
      donationId,
      bloodGroupId,
      collectionDate: seed.donationDate,
      expiryDate: computeExpiryDate(seed.donationDate),
      status: seed.inventoryStatus,
      facilityId,
      createdAt: seed.createdAt,
      updatedAt: seed.createdAt,
    })
    existingNotes.add(seed.notes)
    inserted += 1
    inventoryInserted += 1
  }

  return { inserted, skipped: dataset.donations.length - inserted, inventoryInserted }
}

async function seedGeneratedRequests(
  db: Db,
  dataset: Generated60DayDataset,
  actorUserId: number,
  bloodGroupIdByCode: Map<string, number>,
  facilityIdByName: Map<string, number>,
  warnings: string[],
): Promise<{ inserted: number; skipped: number }> {
  const from = new Date(`${dataset.anchor}T00:00:00.000Z`)
  from.setUTCDate(from.getUTCDate() - 59)
  const to = new Date(`${dataset.anchor}T23:59:59.000Z`)
  const existing = await db.select({
    facilityId: bloodRequests.facilityId,
    bloodGroupId: bloodRequests.bloodGroupId,
    requestedAt: bloodRequests.requestedAt,
  }).from(bloodRequests).where(and(gte(bloodRequests.requestedAt, from), lte(bloodRequests.requestedAt, to)))
  const keys = new Set(existing.map((row) => `${row.facilityId}|${row.bloodGroupId}|${timestampKey(row.requestedAt)}`))
  let inserted = 0

  for (const seed of dataset.requests) {
    const facilityId = facilityIdByName.get(seed.facilityName)
    const bloodGroupId = bloodGroupIdByCode.get(seed.bloodGroupCode)
    if (!facilityId || !bloodGroupId) {
      warnings.push(`60-day request ${seed.key}: facility or blood group missing`)
      continue
    }
    const key = `${facilityId}|${bloodGroupId}|${timestampKey(seed.requestedAt)}`
    if (keys.has(key)) continue
    await db.insert(bloodRequests).values({
      facilityId,
      bloodGroupId,
      unitsRequested: seed.unitsRequested,
      priority: seed.priority,
      requestedAt: seed.requestedAt,
      requiredAt: seed.requiredAt,
      status: seed.status,
      fulfilledUnits: seed.fulfilledUnits,
      createdBy: actorUserId,
      createdAt: seed.requestedAt,
      updatedAt: seed.requestedAt,
    })
    keys.add(key)
    inserted += 1
  }
  return { inserted, skipped: dataset.requests.length - inserted }
}

async function seedGeneratedDemand(
  db: Db,
  dataset: Generated60DayDataset,
  bloodGroupIdByCode: Map<string, number>,
  facilityIdByName: Map<string, number>,
  warnings: string[],
): Promise<{ inserted: number; skipped: number }> {
  const start = dataset.demand[0]?.date ?? dataset.anchor
  const existing = await db.select({
    facilityId: demandRecords.facilityId,
    bloodGroupId: demandRecords.bloodGroupId,
    date: demandRecords.date,
  }).from(demandRecords).where(and(
    eq(demandRecords.source, 'IMPORT'),
    gte(demandRecords.date, start),
    lte(demandRecords.date, dataset.anchor),
  ))
  const keys = new Set(existing.map((row) => `${dateKey(row.date)}|${row.bloodGroupId}|${row.facilityId ?? 'null'}`))
  const rows: Array<typeof demandRecords.$inferInsert> = []

  for (const seed of dataset.demand) {
    const facilityId = facilityIdByName.get(seed.facilityName)
    const bloodGroupId = bloodGroupIdByCode.get(seed.bloodGroupCode)
    if (!facilityId || !bloodGroupId) {
      warnings.push(`60-day demand ${seed.key}: facility or blood group missing`)
      continue
    }
    const key = `${seed.date}|${bloodGroupId}|${facilityId}`
    if (keys.has(key)) continue
    rows.push({
      facilityId,
      bloodGroupId,
      date: seed.date,
      unitsRequested: seed.unitsRequested,
      unitsIssued: seed.unitsIssued,
      unitsUsed: seed.unitsUsed,
      unfulfilledUnits: seed.unfulfilledUnits,
      source: 'IMPORT',
      createdAt: new Date(`${seed.date}T23:00:00.000Z`),
    })
    keys.add(key)
  }
  for (let index = 0; index < rows.length; index += 100) {
    await db.insert(demandRecords).values(rows.slice(index, index + 100))
  }
  return { inserted: rows.length, skipped: dataset.demand.length - rows.length }
}

async function seedGeneratedPredictions(
  db: Db,
  dataset: Generated60DayDataset,
  bloodGroupIdByCode: Map<string, number>,
  facilityIdByName: Map<string, number>,
  warnings: string[],
): Promise<{ inserted: number; skipped: number; predictionIdByKey: Map<string, number> }> {
  const versions = dataset.predictions.map((row) => row.modelVersion)
  const existing = await db.select({ id: aiPredictions.id, modelVersion: aiPredictions.modelVersion })
    .from(aiPredictions).where(inArray(aiPredictions.modelVersion, versions))
  const idByVersion = new Map(existing.map((row) => [row.modelVersion, row.id]))
  const predictionIdByKey = new Map<string, number>()
  let inserted = 0

  for (const seed of dataset.predictions) {
    let id = idByVersion.get(seed.modelVersion)
    if (!id) {
      const facilityId = facilityIdByName.get(seed.facilityName)
      const bloodGroupId = bloodGroupIdByCode.get(seed.bloodGroupCode)
      if (!facilityId || !bloodGroupId) {
        warnings.push(`60-day prediction ${seed.key}: facility or blood group missing`)
        continue
      }
      const created = await db.insert(aiPredictions).values({
        bloodGroupId,
        facilityId,
        forecastStart: seed.forecastStart,
        forecastEnd: seed.forecastEnd,
        predictedUnits: seed.predictedUnits.toFixed(2),
        modelName: DEMO_60_DAY_MODEL_NAME,
        modelVersion: seed.modelVersion,
        metricsJson: {
          mae: 1.2 + seed.weekIndex / 10,
          rmse: 1.8 + seed.weekIndex / 10,
          wape: 8 + seed.weekIndex,
          horizon_days: 7,
          predictions: seed.points,
        },
        createdAt: seed.createdAt,
      }).$returningId()
      id = created[0]?.id
      if (!id) {
        warnings.push(`60-day prediction ${seed.key}: insert failed`)
        continue
      }
      idByVersion.set(seed.modelVersion, id)
      inserted += 1
    }
    predictionIdByKey.set(seed.key, id)
  }
  return { inserted, skipped: dataset.predictions.length - inserted, predictionIdByKey }
}

async function seedGeneratedAlerts(
  db: Db,
  dataset: Generated60DayDataset,
  predictionIdByKey: Map<string, number>,
  bloodGroupIdByCode: Map<string, number>,
  facilityIdByName: Map<string, number>,
  warnings: string[],
): Promise<{ inserted: number; skipped: number; alertIdByKey: Map<string, number> }> {
  const predictionIds = [...predictionIdByKey.values()]
  const existing = predictionIds.length
    ? await db.select({ id: shortageAlerts.id, predictionId: shortageAlerts.predictionId })
        .from(shortageAlerts).where(inArray(shortageAlerts.predictionId, predictionIds))
    : []
  const idByPrediction = new Map(existing.map((row) => [row.predictionId, row.id]))
  const alertIdByKey = new Map<string, number>()
  let inserted = 0

  for (const seed of dataset.alerts) {
    const predictionId = predictionIdByKey.get(seed.predictionKey)
    if (!predictionId) continue
    let id = idByPrediction.get(predictionId)
    if (!id) {
      const facilityId = facilityIdByName.get(seed.facilityName)
      const bloodGroupId = bloodGroupIdByCode.get(seed.bloodGroupCode)
      if (!facilityId || !bloodGroupId) {
        warnings.push(`60-day alert ${seed.key}: facility or blood group missing`)
        continue
      }
      const created = await db.insert(shortageAlerts).values({
        bloodGroupId,
        facilityId,
        predictionId,
        availableUnits: seed.availableUnits.toFixed(2),
        predictedUnits: seed.predictedUnits.toFixed(2),
        projectedGap: seed.projectedGap.toFixed(2),
        severity: seed.severity,
        status: seed.status,
        createdAt: seed.createdAt,
        resolvedAt: seed.resolvedAt,
      }).$returningId()
      id = created[0]?.id
      if (!id) {
        warnings.push(`60-day alert ${seed.key}: insert failed`)
        continue
      }
      idByPrediction.set(predictionId, id)
      inserted += 1
    }
    alertIdByKey.set(seed.key, id)
  }
  return { inserted, skipped: dataset.alerts.length - inserted, alertIdByKey }
}

async function seedGeneratedNotifications(
  db: Db,
  dataset: Generated60DayDataset,
  actorUserId: number,
  donorIdByNumber: Map<string, number>,
  alertIdByKey: Map<string, number>,
  warnings: string[],
): Promise<{ inserted: number; skipped: number }> {
  const keys = dataset.notifications.map((row) => row.key)
  const existing = await db.select({ key: notifications.deduplicationKey })
    .from(notifications).where(inArray(notifications.deduplicationKey, keys))
  const existingKeys = new Set(existing.map((row) => row.key).filter((key): key is string => Boolean(key)))
  const donorNumbers = [...new Set(dataset.notifications.map((row) => row.donorNumber))]
  const donorContacts = await db.select({
    donorNumber: donors.donorNumber,
    phone: donors.phone,
    email: donors.email,
  }).from(donors).where(inArray(donors.donorNumber, donorNumbers))
  const contactByDonor = new Map(donorContacts.map((row) => [row.donorNumber, row]))
  let inserted = 0

  for (const seed of dataset.notifications) {
    if (existingKeys.has(seed.key)) continue
    const donorId = donorIdByNumber.get(seed.donorNumber)
    const alertId = alertIdByKey.get(seed.alertKey)
    const contact = contactByDonor.get(seed.donorNumber)
    const recipient = seed.channel === 'SMS' ? contact?.phone : contact?.email
    if (!donorId || !alertId || !recipient) {
      warnings.push(`60-day notification ${seed.key}: donor, alert, or recipient missing`)
      continue
    }
    await db.insert(notifications).values({
      donorId,
      alertId,
      channel: seed.channel,
      recipient,
      message: seed.message,
      status: seed.status,
      providerMessageId: seed.providerMessageId,
      deduplicationKey: seed.key,
      deliveryError: seed.deliveryError,
      sentAt: seed.sentAt,
      createdBy: actorUserId,
      createdAt: seed.createdAt,
    })
    existingKeys.add(seed.key)
    inserted += 1
  }
  return { inserted, skipped: dataset.notifications.length - inserted }
}

async function seedGeneratedAiRuns(
  db: Db,
  dataset: Generated60DayDataset,
  actorUserId: number,
  predictionIdByKey: Map<string, number>,
  alertIdByKey: Map<string, number>,
): Promise<{ inserted: number; skipped: number }> {
  const conclusions = dataset.aiRuns.map((row) => row.conclusion)
  const existing = await db.select({ conclusion: aiAnalysisRuns.conclusion })
    .from(aiAnalysisRuns).where(inArray(aiAnalysisRuns.conclusion, conclusions))
  const existingConclusions = new Set(existing.map((row) => row.conclusion))
  let inserted = 0

  for (const seed of dataset.aiRuns) {
    if (existingConclusions.has(seed.conclusion)) continue
    const predictionIds = dataset.predictions
      .filter((prediction) => prediction.weekIndex === seed.weekIndex)
      .map((prediction) => predictionIdByKey.get(prediction.key))
      .filter((id): id is number => typeof id === 'number')
    const alertIds = dataset.alerts
      .filter((alert) => dataset.predictions.find((prediction) => prediction.key === alert.predictionKey)?.weekIndex === seed.weekIndex)
      .map((alert) => alertIdByKey.get(alert.key))
      .filter((id): id is number => typeof id === 'number')
    await db.insert(aiAnalysisRuns).values({
      triggerType: seed.weekIndex === dataset.aiRuns.length - 1 ? 'USER' : 'SCHEDULED',
      triggeredByUserId: actorUserId,
      status: seed.status,
      horizonDays: 60,
      riskLevel: seed.riskLevel,
      notificationMode: seed.notificationMode,
      conclusion: seed.conclusion,
      predictionIdsJson: predictionIds,
      alertIdsJson: alertIds,
      recommendationsJson: {
        shortages: [],
        donors: [],
        centres: [],
        notificationIds: [],
        approvalEmailRecipients: [],
        failures: seed.status === 'PARTIAL' ? ['Synthetic partial-data warning for demonstration.'] : [],
      },
      failureDetails: seed.status === 'PARTIAL' ? 'Synthetic partial-data warning for demonstration.' : null,
      startedAt: seed.startedAt,
      completedAt: seed.completedAt,
      createdAt: seed.startedAt,
    })
    existingConclusions.add(seed.conclusion)
    inserted += 1
  }
  return { inserted, skipped: dataset.aiRuns.length - inserted }
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
  const generatedAnchor = parseDemoDataAnchor(process.env?.DEMO_DATA_AS_OF)
  const generated = generate60DayDemoDataset(generatedAnchor)
  const donorNumbers = [
    ...DEMO_DONOR_SEEDS.map((row) => row.donorNumber),
    ...generated.donors.map((row) => row.donorNumber),
  ]
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
      predictionsInserted: 0,
      predictionsSkipped: 0,
      alertsInserted: 0,
      alertsSkipped: 0,
      notificationsInserted: 0,
      notificationsSkipped: 0,
      aiAnalysisRunsInserted: 0,
      aiAnalysisRunsSkipped: 0,
      generatedAnchor,
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

  const generatedDonors = await seedGeneratedDonors(
    db,
    generated,
    bloodGroupIdByCode,
    warnings,
  )
  const generatedDonations = await seedGeneratedDonations(
    db,
    generated,
    actorUserId,
    generatedDonors.donorIdByNumber,
    bloodGroupIdByCode,
    centreIdByName,
    facilityIdByName,
    warnings,
  )
  const generatedRequests = await seedGeneratedRequests(
    db,
    generated,
    actorUserId,
    bloodGroupIdByCode,
    facilityIdByName,
    warnings,
  )
  const generatedDemand = await seedGeneratedDemand(
    db,
    generated,
    bloodGroupIdByCode,
    facilityIdByName,
    warnings,
  )
  const generatedPredictions = await seedGeneratedPredictions(
    db,
    generated,
    bloodGroupIdByCode,
    facilityIdByName,
    warnings,
  )
  const generatedAlerts = await seedGeneratedAlerts(
    db,
    generated,
    generatedPredictions.predictionIdByKey,
    bloodGroupIdByCode,
    facilityIdByName,
    warnings,
  )
  const generatedNotifications = await seedGeneratedNotifications(
    db,
    generated,
    actorUserId,
    generatedDonors.donorIdByNumber,
    generatedAlerts.alertIdByKey,
    warnings,
  )
  const generatedAiRuns = await seedGeneratedAiRuns(
    db,
    generated,
    actorUserId,
    generatedPredictions.predictionIdByKey,
    generatedAlerts.alertIdByKey,
  )

  return {
    donorsInserted: donorsResult.inserted + generatedDonors.inserted,
    donorsSkipped: donorsResult.skipped + generatedDonors.skipped,
    donationsInserted: donationsResult.donationsInserted + generatedDonations.inserted,
    donationsSkipped: donationsResult.donationsSkipped + generatedDonations.skipped,
    inventoryUnitsInserted: donationsResult.inventoryUnitsInserted + generatedDonations.inventoryInserted,
    requestsInserted: requestsResult.inserted + generatedRequests.inserted,
    requestsSkipped: requestsResult.skipped + generatedRequests.skipped,
    demandInserted: demandResult.inserted + generatedDemand.inserted,
    demandSkipped: demandResult.skipped + generatedDemand.skipped,
    predictionsInserted: generatedPredictions.inserted,
    predictionsSkipped: generatedPredictions.skipped,
    alertsInserted: generatedAlerts.inserted,
    alertsSkipped: generatedAlerts.skipped,
    notificationsInserted: generatedNotifications.inserted,
    notificationsSkipped: generatedNotifications.skipped,
    aiAnalysisRunsInserted: generatedAiRuns.inserted,
    aiAnalysisRunsSkipped: generatedAiRuns.skipped,
    generatedAnchor,
    donorNumbers,
    requestKeys,
    actorUserId,
    warnings,
  }
}
