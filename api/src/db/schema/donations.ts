import {
  date,
  index,
  int,
  mysqlTable,
  text,
  timestamp,
} from 'drizzle-orm/mysql-core'

import { bloodGroups } from './blood-groups'
import { donationCentres } from './donation-centres'
import { donors } from './donors'
import { users } from './users'

export const donations = mysqlTable(
  'donations',
  {
    id: int('id').autoincrement().primaryKey(),
    donorId: int('donor_id')
      .notNull()
      .references(() => donors.id),
    donationCentreId: int('donation_centre_id')
      .notNull()
      .references(() => donationCentres.id),
    bloodGroupId: int('blood_group_id')
      .notNull()
      .references(() => bloodGroups.id),
    donationDate: date('donation_date').notNull(),
    units: int('units').notNull().default(1),
    notes: text('notes'),
    createdBy: int('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('donations_donor_id_idx').on(table.donorId),
    index('donations_donation_date_idx').on(table.donationDate),
    index('donations_blood_group_id_idx').on(table.bloodGroupId),
    index('donations_donation_centre_id_idx').on(table.donationCentreId),
  ],
)
