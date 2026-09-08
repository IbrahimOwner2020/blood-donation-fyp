/**
 * Demo donation centres for local/dev seed (NBTS Tanzania-oriented placeholders).
 * Idempotent key: name + region.
 */

export interface DonationCentreSeed {
    name: string
    region: string
    address: string | null
    active: boolean
}

export const DONATION_CENTRE_SEEDS: readonly DonationCentreSeed[] = [
    {
        name: 'NBTS Dar es Salaam Centre',
        region: 'Dar es Salaam',
        address: 'Ocean Road, Dar es Salaam',
        active: true,
    },
    {
        name: 'NBTS Mwanza Regional Centre',
        region: 'Mwanza',
        address: 'Bugando Area, Mwanza',
        active: true,
    },
    {
        name: 'NBTS Arusha Collection Point',
        region: 'Arusha',
        address: null,
        active: true,
    },
] as const
