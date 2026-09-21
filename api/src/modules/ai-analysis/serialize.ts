import type {
  AiAnalysisNotificationMode,
  AiAnalysisRecommendations,
  AiAnalysisRiskLevel,
  AiAnalysisRunStatus,
  AiAnalysisRunTrigger,
} from '../../db/schema/ai-analysis'

export type AiAnalysisRunRow = {
  id: number
  triggerType: AiAnalysisRunTrigger
  triggeredByUserId: number | null
  status: AiAnalysisRunStatus
  horizonDays: number
  riskLevel: AiAnalysisRiskLevel
  notificationMode: AiAnalysisNotificationMode
  conclusion: string
  predictionIdsJson: number[] | null
  alertIdsJson: number[] | null
  recommendationsJson: AiAnalysisRecommendations | null
  failureDetails: string | null
  startedAt: Date
  completedAt: Date | null
  createdAt: Date
}

export type PublicAiAnalysisRun = {
  id: number
  triggerType: AiAnalysisRunTrigger
  triggeredByUserId: number | null
  status: AiAnalysisRunStatus
  horizonDays: number
  riskLevel: AiAnalysisRiskLevel
  notificationMode: AiAnalysisNotificationMode
  conclusion: string
  predictionIds: number[]
  alertIds: number[]
  recommendations: AiAnalysisRecommendations
  failureDetails: string | null
  startedAt: Date
  completedAt: Date | null
  createdAt: Date
}

export type PublicAiAnalysisSettings = {
  notificationMode: AiAnalysisNotificationMode
}

const emptyRecommendations: AiAnalysisRecommendations = {
  shortages: [],
  donors: [],
  centres: [],
  notificationIds: [],
  approvalEmailRecipients: [],
  failures: [],
}

function normalizeIdList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
}

export function toPublicAiAnalysisRun(
  row: AiAnalysisRunRow | null | undefined,
): PublicAiAnalysisRun | null {
  if (!row?.id) {
    return null
  }

  return {
    id: row.id,
    triggerType: row.triggerType,
    triggeredByUserId: row.triggeredByUserId ?? null,
    status: row.status,
    horizonDays: row.horizonDays,
    riskLevel: row.riskLevel,
    notificationMode: row.notificationMode,
    conclusion: row.conclusion ?? '',
    predictionIds: normalizeIdList(row.predictionIdsJson),
    alertIds: normalizeIdList(row.alertIdsJson),
    recommendations: row.recommendationsJson ?? emptyRecommendations,
    failureDetails: row.failureDetails ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
  }
}
