import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

import { bloodGroups } from './blood-groups'
import { donorEligibilityStatuses } from './enums'
import { users } from './users'

/**
 * Donors. Soft-deactivate with active=false when history must be retained.
 */
export const donors = mysqlTable(
  'donors',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id').references(() => users.id),
    donorNumber: varchar('donor_number', { length: 64 }).notNull(),
    firstName: varchar('first_name', { length: 120 }).notNull(),
    lastName: varchar('last_name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    email: varchar('email', { length: 255 }),
    bloodGroupId: int('blood_group_id')
      .notNull()
      .references(() => bloodGroups.id),
    eligibilityStatus: mysqlEnum(
      'eligibility_status',
      donorEligibilityStatuses,
    )
      .notNull()
      .default('UNKNOWN'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex('donors_user_id_uidx').on(table.userId),
    uniqueIndex('donors_donor_number_uidx').on(table.donorNumber),
    uniqueIndex('donors_phone_uidx').on(table.phone),
    uniqueIndex('donors_email_uidx').on(table.email),
    index('donors_blood_group_id_idx').on(table.bloodGroupId),
    index('donors_active_idx').on(table.active),
    index('donors_eligibility_status_idx').on(table.eligibilityStatus),
  ],
)
