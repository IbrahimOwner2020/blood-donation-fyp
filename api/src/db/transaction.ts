import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { MySqlTransaction } from 'drizzle-orm/mysql-core'
import type {
  MySql2PreparedQueryHKT,
  MySql2QueryResultHKT,
} from 'drizzle-orm/mysql2'

import type { Db } from './client'
import type { AppSchema } from './client'

export type DbTransaction = MySqlTransaction<
  MySql2QueryResultHKT,
  MySql2PreparedQueryHKT,
  AppSchema,
  ExtractTablesWithRelations<AppSchema>
>

/**
 * Runs `fn` inside a MariaDB transaction; rolls back on throw.
 */
export async function withTransaction<T>(
  db: Db,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => fn(tx))
}
