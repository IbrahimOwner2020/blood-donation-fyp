import {
  date,
  decimal,
  index,
  int,
  json,
  mysqlTable,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core'

import { bloodGroups } from './blood-groups'
import { healthcareFacilities } from './healthcare-facilities'

/** Daily forecast point persisted inside metrics_json (docs/14 predictions[]). */
export interface StoredPredictionPoint {
  date: string
  units: number
}

/** Optional train summary when POST /predictions/run requested training. */
export interface StoredTrainSummary {
  selected_model: string
  model_version: string
  metrics?: {
    mae?: number | null
    rmse?: number | null
    wape?: number | null
  } | null
  baseline_metrics?: {
    mae?: number | null
    rmse?: number | null
    wape?: number | null
  } | null
}

/**
 * JSON payload for ai_predictions.metrics_json.
 * Holds AI metrics plus the daily series (no dedicated series column).
 */
export interface PredictionMetrics {
  mae?: number | null
  rmse?: number | null
  wape?: number | null
  horizon_days?: number
  predictions?: StoredPredictionPoint[]
  train?: StoredTrainSummary | null
}

export const aiPredictions = mysqlTable(
  'ai_predictions',
  {
    id: int('id').autoincrement().primaryKey(),
    bloodGroupId: int('blood_group_id')
      .notNull()
      .references(() => bloodGroups.id),
    facilityId: int('facility_id').references(() => healthcareFacilities.id),
    forecastStart: date('forecast_start').notNull(),
    forecastEnd: date('forecast_end').notNull(),
    predictedUnits: decimal('predicted_units', {
      precision: 12,
      scale: 2,
    }).notNull(),
    modelName: varchar('model_name', { length: 120 }).notNull(),
    modelVersion: varchar('model_version', { length: 64 }),
    metricsJson: json('metrics_json').$type<PredictionMetrics | null>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('ai_predictions_group_start_idx').on(
      table.bloodGroupId,
      table.forecastStart,
    ),
    index('ai_predictions_facility_id_idx').on(table.facilityId),
  ],
)
