import { loadEnv, type AppEnv, type EnvSource } from '../lib/env'

export interface DbEnv {
  host: string
  port: number
  user: string
  password: string
  database: string
  connectionLimit: number
}

function connectionLimitFromSource(source?: EnvSource): number {
  const raw = source?.DB_CONNECTION_LIMIT ?? Bun.env.DB_CONNECTION_LIMIT ?? '10'
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
}

/**
 * Maps shared AppEnv (docs/15) into a Drizzle/mysql2 connection config.
 * Prefers `loadEnv()` from conventions so DB + API share one parser.
 */
export function readDbEnv(
  appEnv?: AppEnv,
  source?: EnvSource,
): DbEnv {
  const env = appEnv ?? loadEnv(source)
  return {
    host: env?.DB_HOST ?? 'localhost',
    port: env?.DB_PORT ?? 3306,
    user: env?.DB_USER ?? 'nbts',
    password: env?.DB_PASSWORD ?? 'change-me',
    database: env?.DB_NAME ?? 'nbts_blood_ai',
    connectionLimit: connectionLimitFromSource(source),
  }
}
