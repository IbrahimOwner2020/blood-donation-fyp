import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import mysql, { type Pool } from 'mysql2/promise'

import { readDbEnv, type DbEnv } from './env'
import * as schema from './schema'

export type AppSchema = typeof schema
export type Db = MySql2Database<AppSchema> & { $client: Pool }

export interface CreateDbResult {
  db: Db
  pool: Pool
  env: DbEnv
}

/**
 * Creates a pooled Drizzle client for MariaDB via mysql2.
 * Uses mode `planetscale` so relational queries avoid LATERAL joins
 * unsupported by MariaDB.
 */
export function createDb(envOverrides?: Partial<DbEnv>): CreateDbResult {
  const env = { ...readDbEnv(), ...envOverrides }

  const pool = mysql.createPool({
    host: env.host,
    port: env.port,
    user: env.user,
    password: env.password,
    database: env.database,
    connectionLimit: env.connectionLimit,
    waitForConnections: true,
    namedPlaceholders: true,
  })

  const db = drizzle(pool, {
    schema,
    mode: 'planetscale',
  }) as Db

  return { db, pool, env }
}

let singleton: CreateDbResult | undefined

/** Lazy singleton for request handlers. Prefer createDb() in tests. */
export function getDb(): Db {
  if (!singleton) {
    singleton = createDb()
  }
  return singleton.db
}

export async function closeDb(): Promise<void> {
  if (!singleton) {
    return
  }
  await singleton.pool?.end?.()
  singleton = undefined
}
