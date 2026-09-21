import {
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core'

import { users } from './users'

export const aiAnalysisRunTriggers = ['USER', 'SCHEDULED'] as const
export const aiAnalysisRunStatuses = [
  'RUNNING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
] as const
export const aiAnalysisRiskLevels = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const
export const aiAnalysisNotificationModes = [
  'REQUIRE_APPROVAL',
  'AUTO_SEND',
  'REPORT_ONLY',
] as const

export type AiAnalysisRunTrigger = (typeof aiAnalysisRunTriggers)[number]
export type AiAnalysisRunStatus = (typeof aiAnalysisRunStatuses)[number]
export type AiAnalysisRiskLevel = (typeof aiAnalysisRiskLevels)[number]
export type AiAnalysisNotificationMode =
  (typeof aiAnalysisNotificationModes)[number]

export type AiAnalysisDonorRecommendation = {
  id: number
  donorNumber: string
  firstName: string
  lastName: string
  bloodGroupCode: string | null
  alertId: number
  contactAvailable: boolean
}

export type AiAnalysisCentreRecommendation = {
  id: number
  name: string
  region: string
  address: string | null
}

export type AiAnalysisShortage = {
  alertId: number
  predictionId: number
  bloodGroupId: number
  bloodGroupCode: string | null
  severity: string
  status: string
  availableUnits: number
  predictedUnits: number
  projectedGap: number
}

export type AiAnalysisRecommendations = {
  shortages: AiAnalysisShortage[]
  donors: AiAnalysisDonorRecommendation[]
  centres: AiAnalysisCentreRecommendation[]
  notificationIds: number[]
  approvalEmailRecipients: string[]
  failures: string[]
}

export const aiAnalysisRuns = mysqlTable(
  'ai_analysis_runs',
  {
    id: int('id').autoincrement().primaryKey(),
    triggerType: mysqlEnum('trigger_type', aiAnalysisRunTriggers).notNull(),
    triggeredByUserId: int('triggered_by_user_id').references(() => users.id),
    status: mysqlEnum('status', aiAnalysisRunStatuses)
      .notNull()
      .default('RUNNING'),
    horizonDays: int('horizon_days').notNull().default(60),
    riskLevel: mysqlEnum('risk_level', aiAnalysisRiskLevels)
      .notNull()
      .default('LOW'),
    notificationMode: mysqlEnum(
      'notification_mode',
      aiAnalysisNotificationModes,
    )
      .notNull()
      .default('REQUIRE_APPROVAL'),
    conclusion: text('conclusion').notNull(),
    predictionIdsJson: json('prediction_ids_json').$type<number[]>(),
    alertIdsJson: json('alert_ids_json').$type<number[]>(),
    recommendationsJson:
      json('recommendations_json').$type<AiAnalysisRecommendations | null>(),
    failureDetails: text('failure_details'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('ai_analysis_runs_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    index('ai_analysis_runs_trigger_idx').on(table.triggerType),
  ],
)

export const aiAnalysisSettings = mysqlTable('ai_analysis_settings', {
  id: int('id').primaryKey(),
  notificationMode: mysqlEnum(
    'notification_mode',
    aiAnalysisNotificationModes,
  )
    .notNull()
    .default('REQUIRE_APPROVAL'),
  updatedByUserId: int('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
