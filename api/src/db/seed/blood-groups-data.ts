export interface BloodGroupSeed {
    abo: string
    rh: string
    code: string
}

/** Eight ABO/Rh groups required by docs/06 and TODO.md §1. */
export const BLOOD_GROUP_SEEDS: readonly BloodGroupSeed[] = [
    { abo: 'A', rh: '+', code: 'A+' },
    { abo: 'A', rh: '-', code: 'A-' },
    { abo: 'B', rh: '+', code: 'B+' },
    { abo: 'B', rh: '-', code: 'B-' },
    { abo: 'AB', rh: '+', code: 'AB+' },
    { abo: 'AB', rh: '-', code: 'AB-' },
    { abo: 'O', rh: '+', code: 'O+' },
    { abo: 'O', rh: '-', code: 'O-' },
] as const
