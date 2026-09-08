import {
  date,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
} from 'drizzle-orm/mysql-core'

import { bloodGroups } from './blood-groups'
import { donations } from './donations'
import { inventoryStatuses } from './enums'
import { healthcareFacilities } from './healthcare-facilities'

/**
 * Unit-level inventory linked to donations when available (docs/06).
 */
export const bloodInventory = mysqlTable(
  'blood_inventory',
  {
    id: int('id').autoincrement().primaryKey(),
    donationId: int('donation_id').references(() => donations.id),
    bloodGroupId: int('blood_group_id')
      .notNull()
      .references(() => bloodGroups.id),
    collectionDate: date('collection_date').notNull(),
    expiryDate: date('expiry_date').notNull(),
    status: mysqlEnum('status', inventoryStatuses)
      .notNull()
      .default('AVAILABLE'),
    facilityId: int('facility_id').references(() => healthcareFacilities.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('blood_inventory_group_status_idx').on(
      table.bloodGroupId,
      table.status,
    ),
    index('blood_inventory_expiry_date_idx').on(table.expiryDate),
    index('blood_inventory_donation_id_idx').on(table.donationId),
    index('blood_inventory_facility_id_idx').on(table.facilityId),
  ],
)
