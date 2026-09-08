/**
 * Admin-only seed command:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... bun run src/db/seed/admin-user-cli.ts
 */

import { migrate } from 'drizzle-orm/mysql2/migrator'

import { createDb } from '../client'
import { seedAdminUser } from './admin-user'
import { seedRolesPermissions } from './roles-permissions'

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  )
}

async function main(): Promise<void> {
  const { db, pool, env } = createDb()

  try {
    const skipMigration = isTruthy(process.env?.SKIP_ADMIN_MIGRATION)
    if (!skipMigration) {
      await migrate(db, {
        migrationsFolder: `${import.meta.dir}/../../../drizzle`,
      })
    }
    const rolesResult = await seedRolesPermissions(db)
    const adminResult = await seedAdminUser(db)

    console.log(
      JSON.stringify(
        {
          seed: 'admin_user',
          migrate: skipMigration ? 'skipped' : 'ok',
          dbHost: env.host,
          dbPort: env.port,
          dbName: env.database,
          rolesInserted: rolesResult?.rolesInserted ?? 0,
          rolesSkipped: rolesResult?.rolesSkipped ?? 0,
          inserted: adminResult.inserted,
          skipped: adminResult.skipped,
          rolesAssigned: adminResult.rolesAssigned,
          rolesSkipped: adminResult.rolesSkipped,
          email: adminResult.email,
        },
        null,
        2,
      ),
    )
  } finally {
    await pool?.end?.()
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Unknown admin seed failure'
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : undefined
    const dbHost = process.env?.DB_HOST
    const dbPort = process.env?.DB_PORT
    const dbName = process.env?.DB_NAME
    console.error(JSON.stringify({ error: message, cause, dbHost, dbPort, dbName }))
    process.exitCode = 1
  })
}
