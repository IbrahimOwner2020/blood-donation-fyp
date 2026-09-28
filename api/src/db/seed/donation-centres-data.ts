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
        address: 'Sokoine Road, Arusha',
        active: true,
    },
    {
        name: 'NBTS Dodoma Centre',
        region: 'Dodoma',
        address: 'Njedengwa, Dodoma',
        active: true,
    },
    {
        name: 'NBTS Mbeya Collection Point',
        region: 'Mbeya',
        address: 'Hospital Hill, Mbeya',
        active: true,
    },
    {
        name: 'NBTS Zanzibar Centre',
        region: 'Mjini Magharibi',
        address: 'Mnazi Mmoja, Zanzibar',
        active: true,
    },
] as const
