import type { DonorSex } from '../../db/schema/enums'

export const MIN_DONOR_AGE = 18
export const MAX_DONOR_AGE = 65
export const MIN_DONOR_WEIGHT_KG = 50

export type PreliminaryEligibilityStatus =
  | 'ELIGIBLE'
  | 'WAITING_PERIOD'
  | 'UNDERAGE'
  | 'OVERAGE'
  | 'UNDERWEIGHT'
  | 'PROFILE_INCOMPLETE'
  | 'INACTIVE'

export type DonorEligibilityInput = {
  active: boolean
  dateOfBirth: string | Date | null
  sex: DonorSex | null
  weightKg: number | null
  address: string | null
  phone: string | null
  email: string | null
  lastDonationDate: string | Date | null
  today?: string
}

export type DonorEligibilityResult = {
  status: PreliminaryEligibilityStatus
  reasons: string[]
  profileComplete: boolean
  age: number | null
  nextEligibleDate: string | null
  daysUntilEligible: number | null
}

function dateOnlyValue(value: string | Date): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : null
}

function parseDateOnly(value: string | Date): Date | null {
  const dateOnly = dateOnlyValue(value)
  if (!dateOnly) return null
  const [year, month, day] = dateOnly.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addCalendarMonths(value: string | Date, months: number): string | null {
  const source = parseDateOnly(value)
  if (!source) return null
  const year = source.getUTCFullYear()
  const month = source.getUTCMonth() + months
  const day = source.getUTCDate()
  const first = new Date(Date.UTC(year, month, 1))
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate()
  return formatDateOnly(
    new Date(
      Date.UTC(
        first.getUTCFullYear(),
        first.getUTCMonth(),
        Math.min(day, lastDay),
      ),
    ),
  )
}

export function ageOn(dateOfBirth: string | Date, onDate: string): number | null {
  const birth = parseDateOnly(dateOfBirth)
  const current = parseDateOnly(onDate)
  if (!birth || !current || birth > current) return null
  let age = current.getUTCFullYear() - birth.getUTCFullYear()
  const birthdayPassed =
    current.getUTCMonth() > birth.getUTCMonth() ||
    (current.getUTCMonth() === birth.getUTCMonth() &&
      current.getUTCDate() >= birth.getUTCDate())
  if (!birthdayPassed) age -= 1
  return age
}

export function calculateDonorEligibility(
  input: DonorEligibilityInput,
): DonorEligibilityResult {
  const today = input.today ?? formatDateOnly(new Date())
  const profileComplete = Boolean(
    input.dateOfBirth &&
      input.sex &&
      input.weightKg !== null &&
      input.address?.trim() &&
      input.phone?.trim() &&
      input.email?.trim(),
  )
  const age = input.dateOfBirth ? ageOn(input.dateOfBirth, today) : null
  const nextEligibleDate =
    input.lastDonationDate && input.sex
      ? addCalendarMonths(input.lastDonationDate, input.sex === 'MALE' ? 3 : 4)
      : null
  const todayDate = parseDateOnly(today)
  const nextDate = nextEligibleDate ? parseDateOnly(nextEligibleDate) : null
  const daysUntilEligible =
    todayDate && nextDate
      ? Math.max(
          0,
          Math.ceil((nextDate.getTime() - todayDate.getTime()) / 86_400_000),
        )
      : null

  if (!input.active) {
    return { status: 'INACTIVE', reasons: ['Donor record is inactive'], profileComplete, age, nextEligibleDate, daysUntilEligible }
  }
  if (!profileComplete || age === null) {
    return { status: 'PROFILE_INCOMPLETE', reasons: ['Complete date of birth, sex, weight, address, phone, and email'], profileComplete, age, nextEligibleDate, daysUntilEligible }
  }
  if (age < MIN_DONOR_AGE) {
    return { status: 'UNDERAGE', reasons: [`Donor must be at least ${MIN_DONOR_AGE} years old`], profileComplete, age, nextEligibleDate, daysUntilEligible }
  }
  if (age > MAX_DONOR_AGE) {
    return { status: 'OVERAGE', reasons: [`Donor must not be older than ${MAX_DONOR_AGE} years`], profileComplete, age, nextEligibleDate, daysUntilEligible }
  }
  if ((input.weightKg ?? 0) < MIN_DONOR_WEIGHT_KG) {
    return { status: 'UNDERWEIGHT', reasons: [`Donor must weigh at least ${MIN_DONOR_WEIGHT_KG} kg`], profileComplete, age, nextEligibleDate, daysUntilEligible }
  }
  if (daysUntilEligible !== null && daysUntilEligible > 0) {
    return { status: 'WAITING_PERIOD', reasons: [`Eligible again on ${nextEligibleDate}`], profileComplete, age, nextEligibleDate, daysUntilEligible }
  }
  return { status: 'ELIGIBLE', reasons: ['Preliminary requirements are met; medical screening is still required'], profileComplete, age, nextEligibleDate, daysUntilEligible }
}
