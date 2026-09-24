/**
 * Public donor DTO — includes blood group summary for list/detail UX.
 */

import type { DonorEligibilityStatus, DonorSex } from '../../db/schema/enums'
import type { DonorEligibilityResult } from './eligibility'

export type PublicBloodGroup = {
  id: number
  code: string
  abo: string
  rh: string
}

export type PublicDonor = {
  id: number
  userId: number | null
  donorNumber: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  dateOfBirth: string | null
  sex: DonorSex | null
  address: string | null
  weightKg: number | null
  smsConsent: boolean
  emailConsent: boolean
  bloodGroupId: number
  bloodGroup: PublicBloodGroup | null
  /**
   * Operational flag only. POTENTIALLY_ELIGIBLE means registered / potentially
   * eligible for outreach — not a medical approval.
   */
  eligibilityStatus: DonorEligibilityStatus
  active: boolean
  donationCount: number
  lastDonationDate: string | null
  preliminaryEligibility: DonorEligibilityResult
  createdAt: Date
  updatedAt: Date
}

export type DonorRow = {
  id: number
  userId: number | null
  donorNumber: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  dateOfBirth?: string | null
  sex?: DonorSex | null
  address?: string | null
  weightKg?: number | null
  smsConsent?: boolean
  emailConsent?: boolean
  bloodGroupId: number
  eligibilityStatus: DonorEligibilityStatus
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export type BloodGroupRow = {
  id: number
  code: string
  abo: string
  rh: string
}

export function toPublicBloodGroup(
  group: BloodGroupRow | null | undefined,
): PublicBloodGroup | null {
  if (!group?.id || !group?.code) {
    return null
  }

  return {
    id: group.id,
    code: group.code,
    abo: group.abo ?? '',
    rh: group.rh ?? '',
  }
}

/** Map DB donor (+ optional joined blood group) to API shape. */
export function toPublicDonor(
  donor: DonorRow | null | undefined,
  bloodGroup: BloodGroupRow | null | undefined = null,
  activity?: {
    donationCount?: number
    lastDonationDate?: string | null
    preliminaryEligibility: DonorEligibilityResult
  },
): PublicDonor | null {
  if (!donor?.id) {
    return null
  }

  return {
    id: donor.id,
    userId: donor.userId ?? null,
    donorNumber: donor.donorNumber ?? '',
    firstName: donor.firstName ?? '',
    lastName: donor.lastName ?? '',
    phone: donor.phone ?? null,
    email: donor.email ?? null,
    dateOfBirth: donor.dateOfBirth ?? null,
    sex: donor.sex ?? null,
    address: donor.address ?? null,
    weightKg: donor.weightKg ?? null,
    smsConsent: donor.smsConsent ?? false,
    emailConsent: donor.emailConsent ?? false,
    bloodGroupId: donor.bloodGroupId,
    bloodGroup: toPublicBloodGroup(bloodGroup),
    eligibilityStatus: donor.eligibilityStatus ?? 'UNKNOWN',
    active: donor.active ?? false,
    donationCount: activity?.donationCount ?? 0,
    lastDonationDate: activity?.lastDonationDate ?? null,
    preliminaryEligibility:
      activity?.preliminaryEligibility ?? {
        status: 'PROFILE_INCOMPLETE',
        reasons: ['Complete the donor profile'],
        profileComplete: false,
        age: null,
        nextEligibleDate: null,
        daysUntilEligible: null,
      },
    createdAt: donor.createdAt,
    updatedAt: donor.updatedAt,
  }
}
