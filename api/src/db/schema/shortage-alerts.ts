import {
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
} from 'drizzle-orm/mysql-core'

import { aiPredictions } from './ai-predictions'
import { bloodGroups } from './blood-groups'
import { alertSeverities, alertStatuses } from './enums'
import { healthcareFacilities } from './healthcare-facilities'

export const shortageAlerts = mysqlTable(
  'shortage_alerts',
  {
    id: int('id').autoincrement().primaryKey(),
    bloodGroupId: int('blood_group_id')
      .notNull()
      .references(() => bloodGroups.id),
    facilityId: int('facility_id').references(() => healthcareFacilities.id),
    predictionId: int('prediction_id')
      .notNull()
      .references(() => aiPredictions.id),
    availableUnits: decimal('available_units', {
      precision: 12,
      scale: 2,
    }).notNull(),
    predictedUnits: decimal('predicted_units', {
      precision: 12,
      scale: 2,
    }).notNull(),
    projectedGap: decimal('projected_gap', {
      precision: 12,
      scale: 2,
    }).notNull(),
    severity: mysqlEnum('severity', alertSeverities).notNull(),
    status: mysqlEnum('status', alertStatuses).notNull().default('OPEN'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
  },
  (table) => [
    index('shortage_alerts_status_severity_idx').on(
      table.status,
      table.severity,
    ),
    index('shortage_alerts_blood_group_id_idx').on(table.bloodGroupId),
    index('shortage_alerts_prediction_id_idx').on(table.predictionId),
  ],
)
