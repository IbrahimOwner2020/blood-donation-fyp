/**
 * Pure donor-matching filter rules (docs/08, TODO.md §7).
 *
 * Identifies potentially eligible registered donors for outreach review.
 * Does NOT medically approve donors and does NOT send notifications.
 */

import type { DonorEligibilityStatus } from '../../db/schema/enums'

/** Eligibility statuses that permit inclusion in match results. */
export const MATCHABLE_ELIGIBILITY_STATUSES = [
  'POTENTIALLY_ELIGIBLE',
] as const satisfies readonly DonorEligibilityStatus[]

export type MatchableEligibilityStatus =
  (typeof MATCHABLE_ELIGIBILITY_STATUSES)[number]

export const MATCH_DISCLAIMER =
  'Matches are potentially eligible registered donors for review — not a medical approval. Notifications are never sent automatically.'

export type DonorMatchCandidateInput = {
  bloodGroupId: number
  active: boolean
  eligibilityStatus: DonorEligibilityStatus | null | undefined
  phone?: string | null
  email?: string | null
}

/**
 * True when phone or email is a non-empty string (contact available for outreach).
 */
export function hasContact(
  phone: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const phoneOk =
    typeof phone === 'string' && phone.trim().length > 0
  const emailOk =
    typeof email === 'string' && email.trim().length > 0
  return phoneOk || emailOk
}

/**
 * True when eligibility permits notification review (POTENTIALLY_ELIGIBLE only).
 * Excludes UNKNOWN, INELIGIBLE, TEMPORARILY_INELIGIBLE.
 */
export function isEligibilityMatchable(
  status: DonorEligibilityStatus | null | undefined,
): boolean {
  if (!status) {
    return false
  }
  return (MATCHABLE_ELIGIBILITY_STATUSES as readonly string[]).includes(
    status,
  )
}

/**
 * Full candidate check against an alert blood group.
 * Rules: blood group match, active, potentially eligible, contact present.
 */
export function isDonorMatchCandidate(
  donor: DonorMatchCandidateInput | null | undefined,
  requiredBloodGroupId: number,
): boolean {
  if (!donor) {
    return false
  }
  if (
    typeof requiredBloodGroupId !== 'number' ||
    !Number.isFinite(requiredBloodGroupId) ||
    requiredBloodGroupId <= 0
  ) {
    return false
  }
  if (donor.bloodGroupId !== requiredBloodGroupId) {
    return false
  }
  if (donor.active !== true) {
    return false
  }
  if (!isEligibilityMatchable(donor.eligibilityStatus)) {
    return false
  }
  return hasContact(donor?.phone, donor?.email)
}
