import { date, index, int, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'

import { bloodGroups } from './blood-groups'
import { alertSeverities, alertStatuses } from './enums'
import { healthcareFacilities } from './healthcare-facilities'

export const inventoryAlertKinds = ['LOW_STOCK', 'EXPIRING_UNIT'] as const

export const inventoryAlerts = mysqlTable(
  'inventory_alerts',
  {
    id: int('id').autoincrement().primaryKey(),
    kind: mysqlEnum('kind', inventoryAlertKinds).notNull(),
    bloodGroupId: int('blood_group_id').notNull().references(() => bloodGroups.id),
    facilityId: int('facility_id').references(() => healthcareFacilities.id),
    inventoryUnitId: int('inventory_unit_id'),
    currentUnits: int('current_units'),
    thresholdUnits: int('threshold_units'),
    expiryDate: date('expiry_date'),
    conditionKey: varchar('condition_key', { length: 255 }).notNull(),
    severity: mysqlEnum('severity', alertSeverities).notNull(),
    status: mysqlEnum('status', alertStatuses).notNull().default('OPEN'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
    resolvedAt: timestamp('resolved_at'),
  },
  (table) => [
    uniqueIndex('inventory_alerts_condition_key_uidx').on(table.conditionKey),
    index('inventory_alerts_status_severity_idx').on(table.status, table.severity),
    index('inventory_alerts_facility_kind_idx').on(table.facilityId, table.kind),
  ],
)
