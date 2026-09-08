import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
} from 'drizzle-orm/mysql-core'

import { bloodGroups } from './blood-groups'
import { bloodRequestPriorities, bloodRequestStatuses } from './enums'
import { healthcareFacilities } from './healthcare-facilities'
import { users } from './users'

export const bloodRequests = mysqlTable(
  'blood_requests',
  {
    id: int('id').autoincrement().primaryKey(),
    facilityId: int('facility_id')
      .notNull()
      .references(() => healthcareFacilities.id),
    bloodGroupId: int('blood_group_id')
      .notNull()
      .references(() => bloodGroups.id),
    unitsRequested: int('units_requested').notNull(),
    priority: mysqlEnum('priority', bloodRequestPriorities)
      .notNull()
      .default('MEDIUM'),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
    requiredAt: timestamp('required_at'),
    status: mysqlEnum('status', bloodRequestStatuses)
      .notNull()
      .default('PENDING'),
    fulfilledUnits: int('fulfilled_units').notNull().default(0),
    createdBy: int('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('blood_requests_facility_status_idx').on(
      table.facilityId,
      table.status,
    ),
    index('blood_requests_blood_group_id_idx').on(table.bloodGroupId),
    index('blood_requests_required_at_idx').on(table.requiredAt),
  ],
)
