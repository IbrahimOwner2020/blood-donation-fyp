import {
  boolean,
  index,
  int,
  mysqlTable,
  text,
  varchar,
} from 'drizzle-orm/mysql-core'

export const donationCentres = mysqlTable(
  'donation_centres',
  {
    id: int('id').autoincrement().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    region: varchar('region', { length: 120 }).notNull(),
    address: text('address'),
    active: boolean('active').notNull().default(true),
  },
  (table) => [
    index('donation_centres_region_idx').on(table.region),
    index('donation_centres_active_idx').on(table.active),
  ],
)
