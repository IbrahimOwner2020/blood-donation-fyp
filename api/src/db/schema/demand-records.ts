import {
  date,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
} from 'drizzle-orm/mysql-core'

import { bloodGroups } from './blood-groups'
import { demandSources } from './enums'
import { healthcareFacilities } from './healthcare-facilities'

/**
 * Consistent AI training time-series inputs (docs/06).
 */
export const demandRecords = mysqlTable(
  'demand_records',
  {
    id: int('id').autoincrement().primaryKey(),
    facilityId: int('facility_id').references(() => healthcareFacilities.id),
    bloodGroupId: int('blood_group_id')
      .notNull()
      .references(() => bloodGroups.id),
    date: date('date').notNull(),
    unitsRequested: int('units_requested').notNull().default(0),
    unitsIssued: int('units_issued').notNull().default(0),
    unitsUsed: int('units_used'),
    unfulfilledUnits: int('unfulfilled_units'),
    source: mysqlEnum('source', demandSources).notNull().default('SYSTEM'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('demand_records_date_group_idx').on(table.date, table.bloodGroupId),
    index('demand_records_facility_id_idx').on(table.facilityId),
  ],
)
