/**
 * Public donor DTO — includes blood group summary for list/detail UX.
 */

import type { DonorEligibilityStatus } from '../../db/schema/enums'

export type PublicBloodGroup = {
  id: number
  code: string
  abo: string
  rh: string
}

export type PublicDonor = {
  id: number
  donorNumber: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  bloodGroupId: number
  bloodGroup: PublicBloodGroup | null
  /**
   * Operational flag only. POTENTIALLY_ELIGIBLE means registered / potentially
   * eligible for outreach — not a medical approval.
   */
  eligibilityStatus: DonorEligibilityStatus
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export type DonorRow = {
  id: number
  donorNumber: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
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
): PublicDonor | null {
  if (!donor?.id) {
    return null
  }

  return {
    id: donor.id,
    donorNumber: donor.donorNumber ?? '',
    firstName: donor.firstName ?? '',
    lastName: donor.lastName ?? '',
    phone: donor.phone ?? null,
    email: donor.email ?? null,
    bloodGroupId: donor.bloodGroupId,
    bloodGroup: toPublicBloodGroup(bloodGroup),
    eligibilityStatus: donor.eligibilityStatus ?? 'UNKNOWN',
    active: donor.active ?? false,
    createdAt: donor.createdAt,
    updatedAt: donor.updatedAt,
  }
}
