/**
 * AI service HTTP contracts mirrored from docs/14-api-ai-contracts.md
 * and ai-service/app/schemas.py (read-only alignment).
 */

export const BLOOD_GROUPS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
] as const

export type BloodGroup = (typeof BLOOD_GROUPS)[number]

export type HorizonDays = 7 | 14 | 30 | 60

export type BaselineModelName =
  | 'historical_average'
  | 'moving_average'
  | 'seasonal_naive'

export type CandidateModelName =
  | BaselineModelName
  | 'random_forest'
  | 'hist_gradient_boosting'
  | 'llm'

/** Optional forecast selector; `llm` uses AI-service OpenAI (primary) or Ollama. */
export type PreferredForecastModel = CandidateModelName

export interface AiHealthResponse {
  service: string
  status: string
}

/** Non-throwing health probe result for degraded API behaviour. */
export type AiHealthCheckResult =
  | {
      ok: true
      degraded: false
      data: AiHealthResponse
    }
  | {
      ok: false
      degraded: true
      reason: string
      statusCode?: number
      aiErrorCode?: string
    }

export interface AiErrorBody {
  code: string
  message: string
}

export interface AiErrorResponse {
  error: AiErrorBody
}

export interface HistoryPoint {
  date: string
  demand_units: number
}

export interface ForecastRequest {
  blood_group: BloodGroup
  facility_id?: string | null
  horizon_days?: HorizonDays
  history: HistoryPoint[]
  /** When `llm`, AI service calls configured OpenAI (primary) or Ollama provider. */
  preferred_model?: PreferredForecastModel | null
}

export interface PredictionPoint {
  date: string
  units: number
}

export interface AiMetrics {
  mae?: number | null
  rmse?: number | null
  wape?: number | null
}

export interface ForecastResponse {
  blood_group: BloodGroup
  facility_id?: string | null
  horizon_days: HorizonDays
  model: string
  model_version: string
  predictions: PredictionPoint[]
  total_predicted_units: number
  metrics?: AiMetrics | null
}

export interface TrainingSeriesPoint {
  blood_group: BloodGroup
  facility_id?: string | null
  date: string
  demand_units: number
}

export interface TrainRequest {
  series: TrainingSeriesPoint[]
  candidate_models?: CandidateModelName[]
}

export interface TrainResponse {
  selected_model: string
  model_version: string
  metrics: AiMetrics
  baseline_metrics: AiMetrics
}

export interface ModelSummary {
  model_id: string
  model_name: string
  model_version: string
  blood_group?: BloodGroup | null
  facility_id?: string | null
  trained_at?: string | null
  training_start?: string | null
  training_end?: string | null
  features?: string[]
  target?: string
  horizon_days?: number | null
  metrics?: AiMetrics | null
}

export interface ModelsListResponse {
  models: ModelSummary[]
}

export interface ModelMetricsResponse {
  model_id: string
  model_name: string
  model_version: string
  metrics: AiMetrics
  baseline_metrics?: AiMetrics | null
  training_start?: string | null
  training_end?: string | null
  features?: string[]
  target?: string
  horizon_days?: number | null
}

export type AssistantChatContext = {
  pathname?: string
  search?: string
  filters?: Record<string, unknown>
  [key: string]: unknown
}

export type AssistantChatRequest = {
  message: string
  context?: AssistantChatContext
  permissions: string[]
  toolSessionToken: string
  toolsUrl: string
}

export type AssistantActionProposalWire = {
  id: string
  action: string
  title: string
  description: string
  requiredPermission: string
  payload: Record<string, unknown>
  effect: string
}

export type AssistantChatResponse =
  | {
      type: 'answer'
      message: string
    }
  | {
      type: 'navigation'
      message: string
      path: string
      requiredPermission?: string
    }
  | {
      type: 'permission_denied'
      message: string
      requiredPermission: string
    }
  | {
      type: 'action_proposal'
      message: string
      proposal: AssistantActionProposalWire
    }

export type AiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>
