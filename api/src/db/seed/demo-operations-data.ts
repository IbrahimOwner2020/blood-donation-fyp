/**
 * Demo operational data for local/QA seeding (donors → donations/inventory,
 * blood requests, demand history). Idempotent keys are defined here.
 *
 * Gated by SEED_DEMO_OPERATIONS (see seed/index.ts). Not for production.
 */

export interface DemoDonorSeed {
  /** Unique idempotency key (donors.donor_number). */
  donorNumber: string
  firstName: string
  lastName: string
  phone: string
  email: string
  /** Canonical ABO/Rh code (must exist in blood_groups seed). */
  bloodGroupCode: string
}

export interface DemoDonationSeed {
  /** Links to DemoDonorSeed.donorNumber. */
  donorNumber: string
  /** Centre matched by name (donation_centres seed). */
  centreName: string
  /**
   * Calendar offset from today (UTC): 0 = today, -3 = three days ago.
   * Kept recent so inventory expiry (collection + 35d) stays AVAILABLE.
   */
  donationDateOffsetDays: number
  units: number
  /** Facility name for inventory assignment (optional). */
  facilityName: string | null
  /** Idempotency marker stored in donations.notes. */
  notesKey: string
}

export interface DemoBloodRequestSeed {
  /** Logical idempotency key (matched via status + units + group + facility). */
  requestKey: string
  facilityName: string
  bloodGroupCode: string
  unitsRequested: number
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status: 'PENDING' | 'APPROVED'
  fulfilledUnits: number
  /** requiredAt offset from today (UTC days); null = omit. */
  requiredAtOffsetDays: number | null
}

export interface DemoDemandSeriesSeed {
  /** Logical key for docs / logs. */
  seriesKey: string
  bloodGroupCode: string
  facilityName: string | null
  /** Inclusive day count ending today (UTC). Must be ≥ MIN_TRAINING_ROWS (30). */
  dayCount: number
  /** Base daily unitsRequested; fluctuates mildly by day index. */
  baseUnitsRequested: number
}

/** Stable demo donor numbers — skip insert when present. */
export const DEMO_DONOR_SEEDS: readonly DemoDonorSeed[] = [
  {
    donorNumber: 'NBTS-DEMO-D001',
    firstName: 'Amina',
    lastName: 'Juma',
    phone: '+255700000001',
    email: 'amina.juma@nbts.demo.local',
    bloodGroupCode: 'O+',
  },
  {
    donorNumber: 'NBTS-DEMO-D002',
    firstName: 'Baraka',
    lastName: 'Mwangi',
    phone: '+255700000002',
    email: 'baraka.mwangi@nbts.demo.local',
    bloodGroupCode: 'A+',
  },
  {
    donorNumber: 'NBTS-DEMO-D003',
    firstName: 'Chiku',
    lastName: 'Hassan',
    phone: '+255700000003',
    email: 'chiku.hassan@nbts.demo.local',
    bloodGroupCode: 'B-',
  },
  {
    donorNumber: 'NBTS-DEMO-D004',
    firstName: 'Daniel',
    lastName: 'Kimaro',
    phone: '+255700000004',
    email: 'daniel.kimaro@nbts.demo.local',
    bloodGroupCode: 'O-',
  },
  {
    donorNumber: 'NBTS-DEMO-D005',
    firstName: 'Ester',
    lastName: 'Ngowi',
    phone: '+255700000005',
    email: 'ester.ngowi@nbts.demo.local',
    bloodGroupCode: 'AB+',
  },
  {
    donorNumber: 'NBTS-DEMO-D006',
    firstName: 'Faraji',
    lastName: 'Said',
    phone: '+255700000006',
    email: 'faraji.said@nbts.demo.local',
    bloodGroupCode: 'B+',
  },
  {
    donorNumber: 'NBTS-DEMO-D007',
    firstName: 'Grace',
    lastName: 'Mushi',
    phone: '+255700000007',
    email: 'grace.mushi@nbts.demo.local',
    bloodGroupCode: 'A-',
  },
  {
    donorNumber: 'NBTS-DEMO-D008',
    firstName: 'Hassan',
    lastName: 'Ally',
    phone: '+255700000008',
    email: 'hassan.ally@nbts.demo.local',
    bloodGroupCode: 'AB-',
  },
  {
    donorNumber: 'NBTS-DEMO-D009',
    firstName: 'Irene',
    lastName: 'Lyimo',
    phone: '+255700000009',
    email: 'irene.lyimo@nbts.demo.local',
    bloodGroupCode: 'O+',
  },
  {
    donorNumber: 'NBTS-DEMO-D010',
    firstName: 'Joseph',
    lastName: 'Mollel',
    phone: '+255700000010',
    email: 'joseph.mollel@nbts.demo.local',
    bloodGroupCode: 'A+',
  },
  {
    donorNumber: 'NBTS-DEMO-D011',
    firstName: 'Neema',
    lastName: 'Kessy',
    phone: '+255700000011',
    email: 'neema.kessy@nbts.demo.local',
    bloodGroupCode: 'O-',
  },
  {
    donorNumber: 'NBTS-DEMO-D012',
    firstName: 'Peter',
    lastName: 'Shirima',
    phone: '+255700000012',
    email: 'peter.shirima@nbts.demo.local',
    bloodGroupCode: 'B+',
  },
] as const

export const DEMO_DONATION_SEEDS: readonly DemoDonationSeed[] = [
  {
    donorNumber: 'NBTS-DEMO-D001',
    centreName: 'NBTS Dar es Salaam Centre',
    donationDateOffsetDays: -2,
    units: 1,
    facilityName: 'Muhimbili National Hospital',
    notesKey: 'DEMO-OPS-DON-001',
  },
  {
    donorNumber: 'NBTS-DEMO-D002',
    centreName: 'NBTS Dar es Salaam Centre',
    donationDateOffsetDays: -5,
    units: 2,
    facilityName: 'Muhimbili National Hospital',
    notesKey: 'DEMO-OPS-DON-002',
  },
  {
    donorNumber: 'NBTS-DEMO-D003',
    centreName: 'NBTS Mwanza Regional Centre',
    donationDateOffsetDays: -1,
    units: 1,
    facilityName: 'Bugando Medical Centre',
    notesKey: 'DEMO-OPS-DON-003',
  },
  {
    donorNumber: 'NBTS-DEMO-D004',
    centreName: 'NBTS Arusha Collection Point',
    donationDateOffsetDays: -7,
    units: 1,
    facilityName: null,
    notesKey: 'DEMO-OPS-DON-004',
  },
  {
    donorNumber: 'NBTS-DEMO-D007',
    centreName: 'NBTS Dodoma Centre',
    donationDateOffsetDays: -3,
    units: 1,
    facilityName: 'Benjamin Mkapa Hospital',
    notesKey: 'DEMO-OPS-DON-005',
  },
  {
    donorNumber: 'NBTS-DEMO-D009',
    centreName: 'NBTS Dar es Salaam Centre',
    donationDateOffsetDays: -4,
    units: 1,
    facilityName: 'Temeke Regional Referral Hospital',
    notesKey: 'DEMO-OPS-DON-006',
  },
  {
    donorNumber: 'NBTS-DEMO-D010',
    centreName: 'NBTS Arusha Collection Point',
    donationDateOffsetDays: -6,
    units: 1,
    facilityName: 'Kilimanjaro Christian Medical Centre',
    notesKey: 'DEMO-OPS-DON-007',
  },
  {
    donorNumber: 'NBTS-DEMO-D012',
    centreName: 'NBTS Mbeya Collection Point',
    donationDateOffsetDays: -1,
    units: 1,
    facilityName: 'Mbeya Zonal Referral Hospital',
    notesKey: 'DEMO-OPS-DON-008',
  },
] as const

/**
 * Distinctive unitsRequested values double as soft idempotency with
 * facility + blood group + status (no request_key column).
 */
export const DEMO_BLOOD_REQUEST_SEEDS: readonly DemoBloodRequestSeed[] = [
  {
    requestKey: 'DEMO-REQ-PENDING-O+',
    facilityName: 'Muhimbili National Hospital',
    bloodGroupCode: 'O+',
    unitsRequested: 11,
    priority: 'HIGH',
    status: 'PENDING',
    fulfilledUnits: 0,
    requiredAtOffsetDays: 3,
  },
  {
    requestKey: 'DEMO-REQ-APPROVED-A+',
    facilityName: 'Kilimanjaro Christian Medical Centre',
    bloodGroupCode: 'A+',
    unitsRequested: 7,
    priority: 'URGENT',
    status: 'APPROVED',
    fulfilledUnits: 2,
    requiredAtOffsetDays: 1,
  },
  {
    requestKey: 'DEMO-REQ-PENDING-O-',
    facilityName: 'Mnazi Mmoja Hospital',
    bloodGroupCode: 'O-',
    unitsRequested: 4,
    priority: 'URGENT',
    status: 'PENDING',
    fulfilledUnits: 0,
    requiredAtOffsetDays: 1,
  },
  {
    requestKey: 'DEMO-REQ-PENDING-B+',
    facilityName: 'Mbeya Zonal Referral Hospital',
    bloodGroupCode: 'B+',
    unitsRequested: 6,
    priority: 'MEDIUM',
    status: 'PENDING',
    fulfilledUnits: 0,
    requiredAtOffsetDays: 5,
  },
  {
    requestKey: 'DEMO-REQ-APPROVED-AB-',
    facilityName: 'Benjamin Mkapa Hospital',
    bloodGroupCode: 'AB-',
    unitsRequested: 3,
    priority: 'HIGH',
    status: 'APPROVED',
    fulfilledUnits: 1,
    requiredAtOffsetDays: 2,
  },
] as const

/** ≥30 days O+ demand so forecast / LLM training thresholds are met. */
export const DEMO_DEMAND_SERIES_SEEDS: readonly DemoDemandSeriesSeed[] = [
  {
    seriesKey: 'DEMO-DEMAND-O+-35D',
    bloodGroupCode: 'O+',
    facilityName: 'Muhimbili National Hospital',
    dayCount: 35,
    baseUnitsRequested: 4,
  },
  {
    seriesKey: 'DEMO-DEMAND-A+-35D',
    bloodGroupCode: 'A+',
    facilityName: 'Kilimanjaro Christian Medical Centre',
    dayCount: 35,
    baseUnitsRequested: 3,
  },
  {
    seriesKey: 'DEMO-DEMAND-B+-35D',
    bloodGroupCode: 'B+',
    facilityName: 'Mbeya Zonal Referral Hospital',
    dayCount: 35,
    baseUnitsRequested: 2,
  },
] as const

/** Marker prefix embedded in donation notes for idempotent re-runs. */
export function demoDonationNotes(notesKey: string): string {
  return `[demo-ops:${notesKey}] Seeded demo donation — safe to re-run seed.`
}

export function isDemoDonationNotes(notes: string | null | undefined): boolean {
  return typeof notes === 'string' && notes.includes('[demo-ops:')
}
