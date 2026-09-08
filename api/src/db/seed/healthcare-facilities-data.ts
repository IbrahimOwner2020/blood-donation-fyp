export interface HealthcareFacilitySeed {
  name: string
  region: string
  district: string
  active: boolean
}

/**
 * Demo Tanzania healthcare facilities for local/dev seeding (docs/06).
 * Not required for production; used by optional seedHealthcareFacilities.
 */
export const HEALTHCARE_FACILITY_SEEDS: readonly HealthcareFacilitySeed[] = [
  {
    name: 'Muhimbili National Hospital',
    region: 'Dar es Salaam',
    district: 'Ilala',
    active: true,
  },
  {
    name: 'Kilimanjaro Christian Medical Centre',
    region: 'Kilimanjaro',
    district: 'Moshi Urban',
    active: true,
  },
  {
    name: 'Bugando Medical Centre',
    region: 'Mwanza',
    district: 'Nyamagana',
    active: true,
  },
  {
    name: 'Mbeya Zonal Referral Hospital',
    region: 'Mbeya',
    district: 'Mbeya Urban',
    active: true,
  },
] as const
