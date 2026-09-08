/**
 * Audit / activity-log public surface (docs/06, docs/10).
 */

export { recordActivity } from './record-activity'
export { withAudit, type WithAuditOptions } from './with-audit'
export {
  redactActivityMetadata,
  buildActivityMetadata,
} from './redact-metadata'
export {
  AuthAuditActions,
  DonationAuditActions,
  DonorAuditActions,
  UserAuditActions,
  RoleAuditActions,
  BloodRequestAuditActions,
  InventoryAuditActions,
  DemandAuditActions,
  PredictionAuditActions,
  AlertAuditActions,
  NotificationAuditActions,
  type AuthAuditAction,
  type DonationAuditAction,
  type DonorAuditAction,
  type UserAuditAction,
  type RoleAuditAction,
  type BloodRequestAuditAction,
  type InventoryAuditAction,
  type DemandAuditAction,
  type PredictionAuditAction,
  type AlertAuditAction,
  type NotificationAuditAction,
  type ActivityMetadata,
  type ActivityLogInsertRow,
  type RecordActivityInput,
  type RecordActivityDeps,
} from './types'
