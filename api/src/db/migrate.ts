/**
 * Programmatic migrator used by Docker entrypoint and:
 *   cd api && bun run db:migrate:runtime
 * (Local alternative: bun run db:migrate via drizzle-kit + ../.env)
 */
import { migrate } from 'drizzle-orm/mysql2/migrator'

import { createDb } from './client'

async function main(): Promise<void> {
  const { db, pool } = createDb()

  try {
    await migrate(db, {
      migrationsFolder: `${import.meta.dir}/../../drizzle`,
    })
    console.log(JSON.stringify({ migrate: 'ok' }))
  } finally {
    await pool?.end?.()
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown migrate failure'
  console.error(JSON.stringify({ error: message }))
  process.exitCode = 1
})
