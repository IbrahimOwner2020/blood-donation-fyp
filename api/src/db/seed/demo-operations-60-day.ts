import type {
  AiAnalysisNotificationMode,
  AiAnalysisRiskLevel,
  AiAnalysisRunStatus,
} from '../schema/ai-analysis'
import type {
  AlertSeverity,
  AlertStatus,
  BloodRequestPriority,
  BloodRequestStatus,
  DonationCategory,
  DonorEligibilityStatus,
  DonorSex,
  InventoryStatus,
  NotificationChannel,
  NotificationStatus,
} from '../schema/enums'

export const DEMO_60_DAY_WINDOW = 60
export const DEMO_60_DAY_DONOR_PREFIX = 'NBTS-DEMO-60D-'
export const DEMO_60_DAY_MODEL_NAME = 'demo-seasonal-baseline'
export const DEMO_60_DAY_MARKER = 'demo-60d'

export const DEMO_BLOOD_GROUPS = [
  'O+',
  'A+',
  'B+',
  'AB+',
  'O-',
  'A-',
  'B-',
  'AB-',
] as const

const FACILITIES = [
  'Muhimbili National Hospital',
  'Kilimanjaro Christian Medical Centre',
  'Bugando Medical Centre',
  'Mbeya Zonal Referral Hospital',
  'Benjamin Mkapa Hospital',
  'Mnazi Mmoja Hospital',
  'Aga Khan Hospital Dar es Salaam',
  'Temeke Regional Referral Hospital',
] as const

const CENTRES = [
  'NBTS Dar es Salaam Centre',
  'NBTS Mwanza Regional Centre',
  'NBTS Arusha Collection Point',
  'NBTS Dodoma Centre',
  'NBTS Mbeya Collection Point',
  'NBTS Zanzibar Centre',
] as const

const FIRST_NAMES = [
  'Asha', 'Bakari', 'Christina', 'Daudi', 'Editha', 'Frank', 'Halima', 'Issa',
  'Janeth', 'Kassim', 'Leila', 'Mussa', 'Neema', 'Omari', 'Rehema', 'Salum',
] as const

const LAST_NAMES = [
  'Abdallah', 'Chacha', 'Haule', 'Kweka', 'Lema', 'Mahenge', 'Mashauri', 'Msuya',
  'Mtebe', 'Mwakalebela', 'Ngowi', 'Nnko', 'Rugemalira', 'Selemani', 'Shayo', 'Yusuph',
] as const

const REGIONS = [
  'Dar es Salaam', 'Mwanza', 'Arusha', 'Dodoma', 'Mbeya', 'Mjini Magharibi',
] as const

const GROUP_WEIGHTS: Readonly<Record<(typeof DEMO_BLOOD_GROUPS)[number], number>> = {
  'O+': 38,
  'A+': 24,
  'B+': 17,
  'AB+': 7,
  'O-': 5,
  'A-': 4,
  'B-': 3,
  'AB-': 2,
}

const GROUP_BASE_DEMAND: Readonly<Record<(typeof DEMO_BLOOD_GROUPS)[number], number>> = {
  'O+': 10,
  'A+': 7,
  'B+': 6,
  'AB+': 3,
  'O-': 4,
  'A-': 3,
  'B-': 2,
  'AB-': 2,
}

export interface GeneratedDemoDonor {
  donorNumber: string
  firstName: string
  lastName: string
  phone: string
  email: string
  dateOfBirth: string
  sex: DonorSex
  address: string
  weightKg: string
  smsConsent: boolean
  emailConsent: boolean
  bloodGroupCode: string
  eligibilityStatus: DonorEligibilityStatus
  active: boolean
  createdAt: Date
}

export interface GeneratedDemoDonation {
  key: string
  donorNumber: string
  centreName: string
  facilityName: string
  bloodGroupCode: string
  donationDate: string
  category: DonationCategory
  weightKgAtDonation: string
  inventoryStatus: InventoryStatus
  notes: string
  createdAt: Date
}

export interface GeneratedDemoRequest {
  key: string
  facilityName: string
  bloodGroupCode: string
  unitsRequested: number
  priority: BloodRequestPriority
  status: BloodRequestStatus
  fulfilledUnits: number
  requestedAt: Date
  requiredAt: Date
}

export interface GeneratedDemoDemand {
  key: string
  facilityName: string
  bloodGroupCode: string
  date: string
  unitsRequested: number
  unitsIssued: number
  unitsUsed: number
  unfulfilledUnits: number
}

export interface GeneratedDemoPrediction {
  key: string
  weekIndex: number
  facilityName: string
  bloodGroupCode: string
  forecastStart: string
  forecastEnd: string
  predictedUnits: number
  availableUnits: number
  modelVersion: string
  createdAt: Date
  points: Array<{ date: string; units: number }>
}

export interface GeneratedDemoAlert {
  key: string
  predictionKey: string
  facilityName: string
  bloodGroupCode: string
  availableUnits: number
  predictedUnits: number
  projectedGap: number
  severity: AlertSeverity
  status: AlertStatus
  createdAt: Date
  resolvedAt: Date | null
}

export interface GeneratedDemoNotification {
  key: string
  alertKey: string
  donorNumber: string
  channel: NotificationChannel
  status: NotificationStatus
  message: string
  providerMessageId: string | null
  deliveryError: string | null
  sentAt: Date | null
  createdAt: Date
}

export interface GeneratedDemoAiRun {
  key: string
  weekIndex: number
  status: AiAnalysisRunStatus
  riskLevel: AiAnalysisRiskLevel
  notificationMode: AiAnalysisNotificationMode
  conclusion: string
  startedAt: Date
  completedAt: Date
}

export interface Generated60DayDataset {
  anchor: string
  donors: GeneratedDemoDonor[]
  donations: GeneratedDemoDonation[]
  requests: GeneratedDemoRequest[]
  demand: GeneratedDemoDemand[]
  predictions: GeneratedDemoPrediction[]
  alerts: GeneratedDemoAlert[]
  notifications: GeneratedDemoNotification[]
  aiRuns: GeneratedDemoAiRun[]
}

function hashSeed(value: string): number {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function parseDemoDataAnchor(value: string | undefined, now = new Date()): string {
  const candidate = value?.trim()
  if (candidate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      throw new Error('DEMO_DATA_AS_OF must use YYYY-MM-DD')
    }
    const parsed = new Date(`${candidate}T00:00:00.000Z`)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
      throw new Error('DEMO_DATA_AS_OF must be a valid calendar date')
    }
    return candidate
  }
  return now.toISOString().slice(0, 10)
}

export function addUtcDays(dateOnly: string, days: number, hour = 10): Date {
  const value = new Date(`${dateOnly}T${String(hour).padStart(2, '0')}:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function weightedGroups(count: number): string[] {
  const weighted = DEMO_BLOOD_GROUPS.flatMap((group) =>
    Array.from({ length: GROUP_WEIGHTS[group] }, () => group),
  )
  return Array.from({ length: count }, (_, index) =>
    weighted[Math.min(weighted.length - 1, Math.floor(index * weighted.length / count))] ?? 'O+',
  )
}

function severityForGap(gap: number): AlertSeverity {
  if (gap >= 12) return 'CRITICAL'
  if (gap >= 8) return 'HIGH'
  if (gap >= 4) return 'MEDIUM'
  return 'LOW'
}

export function generate60DayDemoDataset(anchorInput?: string): Generated60DayDataset {
  const anchor = parseDemoDataAnchor(anchorInput)
  const random = createRandom(anchor)
  const donorGroups = weightedGroups(96)
  const donors: GeneratedDemoDonor[] = donorGroups.map((bloodGroupCode, index) => {
    const ordinal = index + 1
    const sex: DonorSex = index % 2 === 0 ? 'FEMALE' : 'MALE'
    const createdOffset = -(index % DEMO_60_DAY_WINDOW)
    return {
      donorNumber: `${DEMO_60_DAY_DONOR_PREFIX}${String(ordinal).padStart(3, '0')}`,
      firstName: FIRST_NAMES[index % FIRST_NAMES.length] ?? 'Demo',
      lastName: LAST_NAMES[(index * 5) % LAST_NAMES.length] ?? 'Donor',
      phone: `+25571${String(5000000 + ordinal).padStart(7, '0')}`,
      email: `demo60d.donor${String(ordinal).padStart(3, '0')}@nbts.demo.local`,
      dateOfBirth: `${1980 + (index % 22)}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
      sex,
      address: `${REGIONS[index % REGIONS.length]} synthetic demo address`,
      weightKg: (52 + (index % 31) + random()).toFixed(2),
      smsConsent: index % 5 !== 0,
      emailConsent: index % 3 !== 0,
      bloodGroupCode,
      eligibilityStatus: index % 13 === 0 ? 'TEMPORARILY_INELIGIBLE' : 'POTENTIALLY_ELIGIBLE',
      active: index % 19 !== 0,
      createdAt: addUtcDays(anchor, createdOffset, 8 + (index % 8)),
    }
  })

  const donations: GeneratedDemoDonation[] = donors.slice(0, 72).map((donor, index) => {
    const offset = -((index * 7 + 3) % DEMO_60_DAY_WINDOW)
    const donatedAt = addUtcDays(anchor, offset, 9 + (index % 7))
    const ageDays = Math.abs(offset)
    let inventoryStatus: InventoryStatus
    if (ageDays > 35) inventoryStatus = index % 4 === 0 ? 'ISSUED' : 'EXPIRED'
    else if (index % 11 === 0) inventoryStatus = 'DISCARDED'
    else if (index % 7 === 0) inventoryStatus = 'RESERVED'
    else if (index % 5 === 0) inventoryStatus = 'ISSUED'
    else inventoryStatus = 'AVAILABLE'
    const key = `${anchor}-don-${String(index + 1).padStart(3, '0')}`
    return {
      key,
      donorNumber: donor.donorNumber,
      centreName: CENTRES[index % CENTRES.length] ?? CENTRES[0],
      facilityName: FACILITIES[(index * 3) % FACILITIES.length] ?? FACILITIES[0],
      bloodGroupCode: donor.bloodGroupCode,
      donationDate: dateOnly(donatedAt),
      category: index % 6 === 0 ? 'FAMILY_REPLACEMENT' : 'VOLUNTARY',
      weightKgAtDonation: donor.weightKg,
      inventoryStatus,
      notes: `[${DEMO_60_DAY_MARKER}:${key}] Synthetic 60-day demo donation.`,
      createdAt: donatedAt,
    }
  })

  const requestStatuses: BloodRequestStatus[] = ['PENDING', 'APPROVED', 'PARTIAL', 'FULFILLED', 'CANCELLED']
  const priorities: BloodRequestPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
  const requestGroups = weightedGroups(240)
  const requests: GeneratedDemoRequest[] = Array.from({ length: 240 }, (_, index) => {
    const dayOffset = -Math.floor(index / 4)
    const requestedAt = addUtcDays(anchor, dayOffset, 6 + (index % 16))
    const status = requestStatuses[index % requestStatuses.length] ?? 'PENDING'
    const baseUnitsRequested = 1 + ((index * 3) % 12)
    const unitsRequested = status === 'PARTIAL' ? Math.max(2, baseUnitsRequested) : baseUnitsRequested
    const fulfilledUnits = status === 'FULFILLED'
      ? unitsRequested
      : status === 'PARTIAL'
        ? Math.max(1, unitsRequested - 1)
        : 0
    return {
      key: `${anchor}-req-${String(index + 1).padStart(3, '0')}`,
      facilityName: FACILITIES[index % FACILITIES.length] ?? FACILITIES[0],
      bloodGroupCode: requestGroups[index] ?? 'O+',
      unitsRequested,
      priority: priorities[(index + Math.floor(index / 12)) % priorities.length] ?? 'MEDIUM',
      status,
      fulfilledUnits,
      requestedAt,
      requiredAt: new Date(requestedAt.getTime() + (1 + (index % 5)) * 24 * 60 * 60 * 1000),
    }
  })

  const demand: GeneratedDemoDemand[] = []
  for (let dayIndex = 0; dayIndex < DEMO_60_DAY_WINDOW; dayIndex += 1) {
    const date = dateOnly(addUtcDays(anchor, -(DEMO_60_DAY_WINDOW - 1 - dayIndex)))
    for (let groupIndex = 0; groupIndex < DEMO_BLOOD_GROUPS.length; groupIndex += 1) {
      const bloodGroupCode = DEMO_BLOOD_GROUPS[groupIndex] ?? 'O+'
      const base = GROUP_BASE_DEMAND[bloodGroupCode]
      const weeklyWave = (dayIndex % 7) >= 5 ? 2 : 0
      const monthlyWave = dayIndex >= 44 ? 2 : dayIndex >= 28 ? 1 : 0
      const facilityWave = (dayIndex + groupIndex) % 3
      const unitsRequested = Math.max(1, base + weeklyWave + monthlyWave + facilityWave - 1)
      const shortage = (dayIndex + groupIndex) % 6 === 0 ? 2 : (dayIndex + groupIndex) % 4 === 0 ? 1 : 0
      const unitsIssued = Math.max(0, unitsRequested - shortage)
      demand.push({
        key: `${anchor}-demand-${date}-${bloodGroupCode}`,
        facilityName: FACILITIES[(dayIndex + groupIndex * 3) % FACILITIES.length] ?? FACILITIES[0],
        bloodGroupCode,
        date,
        unitsRequested,
        unitsIssued,
        unitsUsed: Math.max(0, unitsIssued - ((dayIndex + groupIndex) % 5 === 0 ? 1 : 0)),
        unfulfilledUnits: unitsRequested - unitsIssued,
      })
    }
  }

  const predictions: GeneratedDemoPrediction[] = []
  for (let weekIndex = 0; weekIndex < 9; weekIndex += 1) {
    const createdAt = addUtcDays(anchor, -(56 - weekIndex * 7), 5)
    for (let groupIndex = 0; groupIndex < DEMO_BLOOD_GROUPS.length; groupIndex += 1) {
      const bloodGroupCode = DEMO_BLOOD_GROUPS[groupIndex] ?? 'O+'
      const start = dateOnly(createdAt)
      const points = Array.from({ length: 7 }, (_, pointIndex) => ({
        date: dateOnly(addUtcDays(start, pointIndex)),
        units: GROUP_BASE_DEMAND[bloodGroupCode] + ((pointIndex + groupIndex + weekIndex) % 4),
      }))
      const predictedUnits = points.reduce((sum, point) => sum + point.units, 0)
      const key = `${anchor}-pred-w${weekIndex}-${bloodGroupCode}`
      predictions.push({
        key,
        weekIndex,
        facilityName: FACILITIES[(weekIndex + groupIndex) % FACILITIES.length] ?? FACILITIES[0],
        bloodGroupCode,
        forecastStart: start,
        forecastEnd: points.at(-1)?.date ?? start,
        predictedUnits,
        availableUnits: Math.max(0, predictedUnits - (2 + ((weekIndex + groupIndex) % 15))),
        modelVersion: `${DEMO_60_DAY_MARKER}-${anchor.replaceAll('-', '')}-w${weekIndex}-${bloodGroupCode.replace('+', 'p').replace('-', 'n')}`,
        createdAt,
        points,
      })
    }
  }

  const alertStatuses: AlertStatus[] = ['RESOLVED', 'DISMISSED', 'ACKNOWLEDGED', 'OPEN']
  const alerts: GeneratedDemoAlert[] = predictions
    .filter((prediction) => prediction.weekIndex === 2 || prediction.weekIndex === 5 || prediction.weekIndex === 8)
    .map((prediction, index) => {
      const gap = Math.max(1, prediction.predictedUnits - prediction.availableUnits)
      const status = alertStatuses[index % alertStatuses.length] ?? 'OPEN'
      return {
        key: `${anchor}-alert-${String(index + 1).padStart(3, '0')}`,
        predictionKey: prediction.key,
        facilityName: prediction.facilityName,
        bloodGroupCode: prediction.bloodGroupCode,
        availableUnits: prediction.availableUnits,
        predictedUnits: prediction.predictedUnits,
        projectedGap: gap,
        severity: severityForGap(gap),
        status,
        createdAt: prediction.createdAt,
        resolvedAt: status === 'RESOLVED' || status === 'DISMISSED'
          ? new Date(prediction.createdAt.getTime() + 2 * 24 * 60 * 60 * 1000)
          : null,
      }
    })

  const notifications: GeneratedDemoNotification[] = Array.from({ length: 96 }, (_, index) => {
    const alert = alerts[index % alerts.length] as GeneratedDemoAlert
    const eligibleDonors = donors.filter((donor) => donor.bloodGroupCode === alert.bloodGroupCode)
    const donor = eligibleDonors[index % eligibleDonors.length] ?? donors[index % donors.length] as GeneratedDemoDonor
    const channel: NotificationChannel = index % 3 === 0 ? 'EMAIL' : 'SMS'
    const statuses: NotificationStatus[] = ['SENT', 'SENT', 'SENT', 'FAILED', 'PENDING', 'CANCELLED']
    const status = statuses[index % statuses.length] ?? 'SENT'
    const createdAt = new Date(alert.createdAt.getTime() + (index % 4) * 60 * 60 * 1000)
    const key = `${DEMO_60_DAY_MARKER}:${anchor}:notification:${String(index + 1).padStart(3, '0')}`
    return {
      key,
      alertKey: alert.key,
      donorNumber: donor.donorNumber,
      channel,
      status,
      message: `Synthetic NBTS demo: ${alert.bloodGroupCode} donors are requested near ${alert.facilityName}.`,
      providerMessageId: status === 'SENT' ? `demo-provider-${String(index + 1).padStart(3, '0')}` : null,
      deliveryError: status === 'FAILED' ? 'Synthetic provider rejection for reporting demonstration.' : null,
      sentAt: status === 'SENT' ? createdAt : null,
      createdAt,
    }
  })

  const aiRuns: GeneratedDemoAiRun[] = Array.from({ length: 9 }, (_, weekIndex) => {
    const startedAt = addUtcDays(anchor, -(56 - weekIndex * 7), 4)
    const risks: AiAnalysisRiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    const statuses: AiAnalysisRunStatus[] = ['COMPLETED', 'COMPLETED', 'PARTIAL']
    const status = statuses[weekIndex % statuses.length] ?? 'COMPLETED'
    const key = `${DEMO_60_DAY_MARKER}:${anchor}:analysis:w${weekIndex}`
    return {
      key,
      weekIndex,
      status,
      riskLevel: risks[weekIndex % risks.length] ?? 'LOW',
      notificationMode: 'REPORT_ONLY',
      conclusion: `[${key}] Synthetic weekly supply analysis for assistant and report demonstrations.`,
      startedAt,
      completedAt: new Date(startedAt.getTime() + 4 * 60 * 1000),
    }
  })

  return { anchor, donors, donations, requests, demand, predictions, alerts, notifications, aiRuns }
}
