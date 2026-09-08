/**
 * Predictions module public surface (TODO.md §7, docs/04, docs/14).
 */

export {
  predictionRoutes,
  PredictionAuditActions,
  type PredictionAuditAction,
} from './routes'
export {
  noopAfterPredictionPersisted,
  type AfterPredictionPersistedContext,
  type AfterPredictionPersistedHook,
} from './hooks'
export {
  bloodGroupCodeSchema,
  candidateModelSchema,
  historyPointSchema,
  horizonDaysSchema,
  latestPredictionQuerySchema,
  listPredictionsQuerySchema,
  predictionIdParamSchema,
  preferredForecastModelSchema,
  runPredictionBodySchema,
  type LatestPredictionQuery,
  type ListPredictionsQuery,
  type PredictionIdParam,
  type RunPredictionBody,
} from './schemas'
export {
  buildMetricsJson,
  toDateOnlyString,
  toPredictedUnitsNumber,
  toPublicBloodGroupSummary,
  toPublicFacilitySummary,
  toPublicPrediction,
  type BloodGroupJoinRow,
  type FacilityJoinRow,
  type PredictionRow,
  type PublicBloodGroupSummary,
  type PublicFacilitySummary,
  type PublicPrediction,
} from './serialize'
export {
  getLatestPrediction,
  getPredictionById,
  listPredictions,
  runPrediction,
  type ListPredictionsResult,
  type RunPredictionDeps,
  type RunPredictionResult,
} from './service'
