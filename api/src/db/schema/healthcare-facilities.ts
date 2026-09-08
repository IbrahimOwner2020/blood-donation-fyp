import {
  boolean,
  index,
  int,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core'

export const healthcareFacilities = mysqlTable(
  'healthcare_facilities',
  {
    id: int('id').autoincrement().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    region: varchar('region', { length: 120 }).notNull(),
    district: varchar('district', { length: 120 }).notNull(),
    active: boolean('active').notNull().default(true),
  },
  (table) => [
    index('healthcare_facilities_region_idx').on(table.region),
    index('healthcare_facilities_active_idx').on(table.active),
  ],
)
