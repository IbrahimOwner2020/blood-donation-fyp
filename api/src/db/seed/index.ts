/**
 * Seed entrypoint:
 *   cd api && bun run db:seed
 *   (or api docker-entrypoint when RUN_SEED=true)
 *
 * Requires migrations applied and MariaDB reachable.
 * Admin user only when SEED_ADMIN_USER is truthy.
 * Demo users only when SEED_DEMO_USERS is truthy, or NODE_ENV is not production.
 * Demo operational data (donors/donations/requests/demand) when
 * SEED_DEMO_OPERATIONS is truthy, or NODE_ENV is not production (same gating).
 */
import { createDb } from '../client'
import { seedAdminUser } from './admin-user'
import { seedBloodGroups } from './blood-groups'
import { seedDemoOperations } from './demo-operations'
import { seedDemoUsers } from './demo-users'
import { seedDonationCentres } from './donation-centres'
import { seedHealthcareFacilities } from './healthcare-facilities'
import { seedRolesPermissions } from './roles-permissions'

function envTruthy(value: string | undefined): boolean | undefined {
  if (value == null || value.trim() === '') {
    return undefined
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false
  }
  return undefined
}

/** Production/demo bootstrap admin; default off unless SEED_ADMIN_USER=true. */
function shouldSeedAdminUser(): boolean {
  return envTruthy(process.env?.SEED_ADMIN_USER) === true
}

/** Local/demo default on; production default off unless SEED_DEMO_USERS=true. */
function shouldSeedDemoUsers(): boolean {
  const explicit = envTruthy(process.env?.SEED_DEMO_USERS)
  if (explicit !== undefined) {
    return explicit
  }
  return (process.env?.NODE_ENV ?? 'development') !== 'production'
}

/**
 * Demo donors/donations/requests/demand — independent of SEED_DEMO_USERS so
 * Railway can keep users off while ops stay off by default in production.
 */
function shouldSeedDemoOperations(): boolean {
  const explicit = envTruthy(process.env?.SEED_DEMO_OPERATIONS)
  if (explicit !== undefined) {
    return explicit
  }
  return (process.env?.NODE_ENV ?? 'development') !== 'production'
}

async function main(): Promise<void> {
  const { db, pool } = createDb()

  try {
    const rolesResult = await seedRolesPermissions(db)
    console.log(
      JSON.stringify(
        {
          seed: 'roles_permissions',
          rolesInserted: rolesResult?.rolesInserted ?? 0,
          rolesSkipped: rolesResult?.rolesSkipped ?? 0,
          permissionsInserted: rolesResult?.permissionsInserted ?? 0,
          permissionsSkipped: rolesResult?.permissionsSkipped ?? 0,
          mappingsInserted: rolesResult?.mappingsInserted ?? 0,
          mappingsSkipped: rolesResult?.mappingsSkipped ?? 0,
          roleNames: rolesResult?.roleNames ?? [],
          permissionCodes: rolesResult?.permissionCodes ?? [],
        },
        null,
        2,
      ),
    )

    const bloodGroupsResult = await seedBloodGroups(db)
    console.log(
      JSON.stringify(
        {
          seed: 'blood_groups',
          inserted: bloodGroupsResult?.inserted ?? 0,
          skipped: bloodGroupsResult?.skipped ?? 0,
          codes: bloodGroupsResult?.codes ?? [],
        },
        null,
        2,
      ),
    )

    if (shouldSeedAdminUser()) {
      const adminResult = await seedAdminUser(db)
      console.log(
        JSON.stringify(
          {
            seed: 'admin_user',
            inserted: adminResult?.inserted ?? 0,
            skipped: adminResult?.skipped ?? 0,
            rolesAssigned: adminResult?.rolesAssigned ?? 0,
            rolesSkipped: adminResult?.rolesSkipped ?? 0,
            email: adminResult?.email ?? null,
          },
          null,
          2,
        ),
      )
    } else {
      console.log(
        JSON.stringify(
          {
            seed: 'admin_user',
            skipped: true,
            reason: 'SEED_ADMIN_USER disabled',
          },
          null,
          2,
        ),
      )
    }

    const centresResult = await seedDonationCentres(db)
    console.log(
      JSON.stringify(
        {
          seed: 'donation_centres',
          inserted: centresResult?.inserted ?? 0,
          skipped: centresResult?.skipped ?? 0,
          names: centresResult?.names ?? [],
        },
        null,
        2,
      ),
    )

    /** Local/demo users (Argon2id); gated for production safety. */
    if (shouldSeedDemoUsers()) {
      const demoUsersResult = await seedDemoUsers(db)
      console.log(
        JSON.stringify(
          {
            seed: 'demo_users',
            inserted: demoUsersResult?.inserted ?? 0,
            skipped: demoUsersResult?.skipped ?? 0,
            rolesAssigned: demoUsersResult?.rolesAssigned ?? 0,
            rolesSkipped: demoUsersResult?.rolesSkipped ?? 0,
            emails: demoUsersResult?.emails ?? [],
          },
          null,
          2,
        ),
      )
    } else {
      console.log(
        JSON.stringify(
          {
            seed: 'demo_users',
            skipped: true,
            reason: 'SEED_DEMO_USERS disabled (or NODE_ENV=production default)',
          },
          null,
          2,
        ),
      )
    }

    /** Optional demo healthcare facilities (idempotent). */
    const facilitiesResult = await seedHealthcareFacilities(db)
    console.log(
      JSON.stringify(
        {
          seed: 'healthcare_facilities',
          inserted: facilitiesResult?.inserted ?? 0,
          skipped: facilitiesResult?.skipped ?? 0,
          names: facilitiesResult?.names ?? [],
        },
        null,
        2,
      ),
    )

    /**
     * Demo operational rows for QA (detail pages, notify, requests, forecasts).
     * After centres/facilities/demo users so FKs and createdBy resolve.
     */
    if (shouldSeedDemoOperations()) {
      const opsResult = await seedDemoOperations(db)
      console.log(
        JSON.stringify(
          {
            seed: 'demo_operations',
            donorsInserted: opsResult?.donorsInserted ?? 0,
            donorsSkipped: opsResult?.donorsSkipped ?? 0,
            donationsInserted: opsResult?.donationsInserted ?? 0,
            donationsSkipped: opsResult?.donationsSkipped ?? 0,
            inventoryUnitsInserted: opsResult?.inventoryUnitsInserted ?? 0,
            requestsInserted: opsResult?.requestsInserted ?? 0,
            requestsSkipped: opsResult?.requestsSkipped ?? 0,
            demandInserted: opsResult?.demandInserted ?? 0,
            demandSkipped: opsResult?.demandSkipped ?? 0,
            donorNumbers: opsResult?.donorNumbers ?? [],
            requestKeys: opsResult?.requestKeys ?? [],
            actorUserId: opsResult?.actorUserId ?? null,
            warnings: opsResult?.warnings ?? [],
          },
          null,
          2,
        ),
      )
    } else {
      console.log(
        JSON.stringify(
          {
            seed: 'demo_operations',
            skipped: true,
            reason:
              'SEED_DEMO_OPERATIONS disabled (or NODE_ENV=production default)',
          },
          null,
          2,
        ),
      )
    }
  } finally {
    await pool?.end?.()
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown seed failure'
  console.error(JSON.stringify({ error: message }))
  process.exitCode = 1
})
