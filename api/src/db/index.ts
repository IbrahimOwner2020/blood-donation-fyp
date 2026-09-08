/**
 * Database module public surface.
 * Conventions / routes should import from `../db` (or `./db` from src root).
 * `src/index.ts` is intentionally left untouched — wire getDb() when ready.
 */

export { closeDb, createDb, getDb, type AppSchema, type CreateDbResult, type Db } from './client'
export { readDbEnv, type DbEnv } from './env'
export * from './schema'
export {
    seedBloodGroups,
    type SeedBloodGroupsResult,
} from './seed/blood-groups'
export { BLOOD_GROUP_SEEDS, type BloodGroupSeed } from './seed/blood-groups-data'
export {
    seedDemoUsers,
    type SeedDemoUsersResult,
} from './seed/demo-users'
export {
    listDemoUserSeeds,
    type DemoUserSeed,
} from './seed/demo-users-data'
export {
    seedHealthcareFacilities,
    findSeededFacilityId,
    type SeedHealthcareFacilitiesResult,
} from './seed/healthcare-facilities'
export {
    HEALTHCARE_FACILITY_SEEDS,
    type HealthcareFacilitySeed,
} from './seed/healthcare-facilities-data'
export { withTransaction, type DbTransaction } from './transaction'
