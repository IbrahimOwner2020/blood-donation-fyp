/**
 * Public donation centre shape — matches donation_centres columns (docs/06).
 */

export type DonationCentreRow = {
  id: number
  name: string
  region: string
  address: string | null
  active: boolean
}

export type PublicDonationCentre = {
  id: number
  name: string
  region: string
  address: string | null
  active: boolean
}

export function toPublicDonationCentre(
  row: DonationCentreRow | null | undefined,
): PublicDonationCentre | null {
  if (!row || typeof row.id !== 'number') {
    return null
  }

  return {
    id: row.id,
    name: row.name ?? '',
    region: row.region ?? '',
    address: row.address ?? null,
    active: Boolean(row.active),
  }
}

export function toPublicDonationCentreList(
  rows: readonly DonationCentreRow[] | null | undefined,
): PublicDonationCentre[] {
  return (rows ?? [])
    .map((row) => toPublicDonationCentre(row))
    .filter((row): row is PublicDonationCentre => row !== null)
}
