/**
 * Public donation DTO — includes related summaries for list/detail UX.
 */

export type PublicBloodGroup = {
  id: number
  code: string
  abo: string
  rh: string
}

export type PublicDonationDonor = {
  id: number
  donorNumber: string
  firstName: string
  lastName: string
}

export type PublicDonationCentreSummary = {
  id: number
  name: string
  region: string
}

export type PublicDonation = {
  id: number
  donorId: number
  donor: PublicDonationDonor | null
  donationCentreId: number
  donationCentre: PublicDonationCentreSummary | null
  bloodGroupId: number
  bloodGroup: PublicBloodGroup | null
  /** Calendar date YYYY-MM-DD */
  donationDate: string
  category: 'VOLUNTARY' | 'FAMILY_REPLACEMENT'
  weightKgAtDonation: number | null
  units: number
  notes: string | null
  createdBy: number
  createdAt: Date
  /** Unit rows created with this donation (create response / detail when loaded). */
  inventoryUnitCount?: number
  inventoryUnitIds?: number[]
}

export type DonationRow = {
  id: number
  donorId: number
  donationCentreId: number
  bloodGroupId: number
  donationDate: Date | string
  category?: 'VOLUNTARY' | 'FAMILY_REPLACEMENT'
  weightKgAtDonation?: string | number | null
  units: number
  notes: string | null
  createdBy: number
  createdAt: Date
}

export type BloodGroupRow = {
  id: number
  code: string
  abo: string
  rh: string
}

export type DonorSummaryRow = {
  id: number
  donorNumber: string
  firstName: string
  lastName: string
}

export type CentreSummaryRow = {
  id: number
  name: string
  region: string
}

/** Normalize MySQL DATE / Date to YYYY-MM-DD. */
export function toDateOnlyString(
  value: Date | string | null | undefined,
): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())
    return match?.[1] ?? value.trim().slice(0, 10)
  }
  const y = value.getUTCFullYear()
  const m = String(value.getUTCMonth() + 1).padStart(2, '0')
  const d = String(value.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

export function toPublicDonationDonor(
  donor: DonorSummaryRow | null | undefined,
): PublicDonationDonor | null {
  if (!donor?.id) {
    return null
  }
  return {
    id: donor.id,
    donorNumber: donor.donorNumber ?? '',
    firstName: donor.firstName ?? '',
    lastName: donor.lastName ?? '',
  }
}

export function toPublicDonationCentreSummary(
  centre: CentreSummaryRow | null | undefined,
): PublicDonationCentreSummary | null {
  if (!centre?.id) {
    return null
  }
  return {
    id: centre.id,
    name: centre.name ?? '',
    region: centre.region ?? '',
  }
}

export type ToPublicDonationOptions = {
  inventoryUnitCount?: number
  inventoryUnitIds?: number[]
}

/** Map DB donation + optional joins to API shape. */
export function toPublicDonation(
  donation: DonationRow | null | undefined,
  relations: {
    bloodGroup?: BloodGroupRow | null
    donor?: DonorSummaryRow | null
    centre?: CentreSummaryRow | null
  } = {},
  options: ToPublicDonationOptions = {},
): PublicDonation | null {
  if (!donation?.id) {
    return null
  }

  const result: PublicDonation = {
    id: donation.id,
    donorId: donation.donorId,
    donor: toPublicDonationDonor(relations.donor),
    donationCentreId: donation.donationCentreId,
    donationCentre: toPublicDonationCentreSummary(relations.centre),
    bloodGroupId: donation.bloodGroupId,
    bloodGroup: toPublicBloodGroup(relations.bloodGroup),
    donationDate: toDateOnlyString(donation.donationDate),
    category: donation.category ?? 'VOLUNTARY',
    weightKgAtDonation:
      donation.weightKgAtDonation === null ||
      donation.weightKgAtDonation === undefined
        ? null
        : Number(donation.weightKgAtDonation),
    units: donation.units ?? 1,
    notes: donation.notes ?? null,
    createdBy: donation.createdBy,
    createdAt: donation.createdAt,
  }

  if (typeof options.inventoryUnitCount === 'number') {
    result.inventoryUnitCount = options.inventoryUnitCount
  }
  if (options.inventoryUnitIds) {
    result.inventoryUnitIds = options.inventoryUnitIds
  }

  return result
}
