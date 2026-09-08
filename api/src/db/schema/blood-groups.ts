import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core'

/**
 * Canonical blood groups. Seed: A± B± AB± O± (docs/06).
 */
export const bloodGroups = mysqlTable('blood_groups', {
  id: int('id').autoincrement().primaryKey(),
  abo: varchar('abo', { length: 2 }).notNull(),
  rh: varchar('rh', { length: 1 }).notNull(),
  code: varchar('code', { length: 3 }).notNull().unique(),
})
