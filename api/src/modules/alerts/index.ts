/**
 * Shortage alerts module public surface (docs/04 alerts/, docs/08, TODO.md §7).
 */

export {
  alertRoutes,
  AlertAuditActions,
  type AlertAuditAction,
} from './routes'
export {
  afterPredictionPersisted,
  createAfterPredictionPersisted,
  type AlertHookDeps,
} from './hooks'
export {
  noopAfterAlertUpserted,
  logMatchCountAfterAlertUpserted,
  createLogMatchCountAfterAlertUpserted,
  type AfterAlertUpsertedContext,
  type AfterAlertUpsertedHook,
  type LogMatchCountHookDeps,
} from './matching'
export {
  buildMatchWhere,
  countMatchesForBloodGroup,
  listMatchesForAlert,
  listMatchesForBloodGroup,
  type ListMatchesForAlertResult,
  type ListMatchesForBloodGroupResult,
} from './matching-service'
export {
  hasContact,
  isDonorMatchCandidate,
  isEligibilityMatchable,
  MATCHABLE_ELIGIBILITY_STATUSES,
  MATCH_DISCLAIMER,
  type DonorMatchCandidateInput,
  type MatchableEligibilityStatus,
} from './match-rules'
export {
  computeProjectedGap,
  computeShortageGap,
  resolveShortageSeverity,
  type GapComputationInput,
  type GapComputationResult,
} from './gap'
export {
  DEFAULT_SHORTAGE_THRESHOLDS,
  loadShortageThresholdsFromEnv,
  normalizeShortageThresholds,
  type ShortageSeverityThresholds,
} from './thresholds'
export {
  ALERT_STATUS_TRANSITIONS,
  ACTIVE_ALERT_STATUSES,
  assertAlertStatusTransition,
  canTransitionAlertStatus,
  isActiveAlertStatus,
  isTerminalAlertStatus,
  shouldStampResolvedAt,
} from './status-machine'
export {
  alertIdParamSchema,
  alertSeveritySchema,
  alertStatusSchema,
  bloodGroupCodeSchema,
  listAlertMatchesQuerySchema,
  listAlertsQuerySchema,
  patchAlertStatusBodySchema,
  recalculateAlertsBodySchema,
  type AlertIdParam,
  type ListAlertMatchesQuery,
  type ListAlertsQuery,
  type PatchAlertStatusBody,
  type RecalculateAlertsBody,
} from './schemas'
export {
  toDecimalNumber,
  toPublicAlert,
  toPublicBloodGroupSummary,
  toPublicFacilitySummary,
  type AlertRow,
  type BloodGroupJoinRow,
  type FacilityJoinRow,
  type PublicAlert,
  type PublicBloodGroupSummary,
  type PublicFacilitySummary,
} from './serialize'
export {
  getAlertById,
  listAlerts,
  patchAlertStatus,
  recalculateAlerts,
  upsertAlertFromShortage,
  type AlertServiceDeps,
  type ListAlertsResult,
  type PatchAlertStatusResult,
  type RecalculateAlertsResult,
  type UpsertAlertResult,
  type UpsertFromPredictionInput,
} from './service'
