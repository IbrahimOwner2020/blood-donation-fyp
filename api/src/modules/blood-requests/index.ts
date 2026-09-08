/**
 * Blood requests module public surface (docs/04, TODO.md §5).
 * Demand records are intentionally not exported here — separate feature.
 */

export { bloodRequestRoutes, BloodRequestAuditActions } from './routes'
export {
  bloodRequestIdParamSchema,
  bloodRequestStatusSchema,
  bloodRequestPrioritySchema,
  listBloodRequestsQuerySchema,
  createBloodRequestBodySchema,
  patchBloodRequestBodySchema,
  type BloodRequestIdParam,
  type ListBloodRequestsQuery,
  type CreateBloodRequestBody,
  type PatchBloodRequestBody,
} from './schemas'
export {
  toPublicBloodRequest,
  toPublicFacilitySummary,
  toPublicBloodGroupSummary,
  type PublicBloodRequest,
  type PublicFacilitySummary,
  type PublicBloodGroupSummary,
  type BloodRequestRow,
} from './serialize'
export {
  listBloodRequests,
  getBloodRequestById,
  createBloodRequest,
  patchBloodRequestStatus,
  type ListBloodRequestsResult,
  type PatchBloodRequestResult,
} from './service'
export {
  BLOOD_REQUEST_TRANSITIONS,
  canTransition,
  isTerminalStatus,
  assertStatusTransition,
  type TransitionContext,
  type TransitionResult,
} from './status-machine'
