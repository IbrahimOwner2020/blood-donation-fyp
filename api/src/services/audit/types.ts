/**
 * Audit / activity-log input types (docs/06 activity_logs, docs/10 Audit Events).
 */

import type { ActivityMetadata } from '../../db/schema/activity-logs'
import type { Db } from '../../db/client'

export type { ActivityMetadata }

/**
 * Input for {@link recordActivity}.
 * `requestId` is stored inside metadata (no dedicated column on activity_logs).
 */
export type RecordActivityInput = {
  actorUserId?: number | null
  action: string
  entityType: string
  entityId?: string | number | null
  metadata?: ActivityMetadata | null
  requestId?: string | null
  ipAddress?: string | null
}

/** Optional injectable deps for tests / transactions. */
export type RecordActivityDeps = {
  db?: Db
  /**
   * Override insert path (unit tests). When provided, `db` is unused.
   */
  insert?: (row: ActivityLogInsertRow) => Promise<void>
}

export type ActivityLogInsertRow = {
  userId: number | null
  action: string
  entityType: string
  entityId: string | null
  metadataJson: ActivityMetadata | null
  ipAddress: string | null
}

/** Canonical auth audit action codes. */
export const AuthAuditActions = {
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILURE: 'auth.login_failure',
  LOGOUT: 'auth.logout',
  ME: 'auth.me',
  CHANGE_PASSWORD: 'auth.change_password',
} as const

export type AuthAuditAction =
  (typeof AuthAuditActions)[keyof typeof AuthAuditActions]

/** Canonical donor audit action codes (docs/10). */
export const DonorAuditActions = {
  CREATE: 'donor.create',
  UPDATE: 'donor.update',
  DEACTIVATE: 'donor.deactivate',
} as const

export type DonorAuditAction =
  (typeof DonorAuditActions)[keyof typeof DonorAuditActions]

/** Canonical user-admin audit action codes (docs/10 Audit Events). */
export const UserAuditActions = {
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DEACTIVATE: 'user.deactivate',
  USER_ROLES_ASSIGN: 'user.roles_assign',
} as const

export type UserAuditAction =
  (typeof UserAuditActions)[keyof typeof UserAuditActions]

/** Canonical role-admin audit action codes (docs/04 POST/PATCH /roles). */
export const RoleAuditActions = {
  CREATE: 'role.create',
  UPDATE: 'role.update',
} as const

export type RoleAuditAction =
  (typeof RoleAuditActions)[keyof typeof RoleAuditActions]

/** Canonical blood-request audit action codes (docs/10 — request status changes). */
export const BloodRequestAuditActions = {
  CREATE: 'blood_request.create',
  STATUS_CHANGE: 'blood_request.status_change',
} as const

export type BloodRequestAuditAction =
  (typeof BloodRequestAuditActions)[keyof typeof BloodRequestAuditActions]

/** Canonical donation audit action codes (docs/10, TODO.md §4). */
export const DonationAuditActions = {
  CREATE: 'donation.create',
  UPDATE: 'donation.update',
} as const

export type DonationAuditAction =
  (typeof DonationAuditActions)[keyof typeof DonationAuditActions]

/** Canonical demand-record audit action codes (TODO.md §5 sync). */
export const DemandAuditActions = {
  SYNC: 'demand.sync',
} as const

export type DemandAuditAction =
  (typeof DemandAuditActions)[keyof typeof DemandAuditActions]

/** Canonical inventory audit action codes (docs/10 — inventory changes). */
export const InventoryAuditActions = {
  UPDATE: 'inventory.update',
} as const

export type InventoryAuditAction =
  (typeof InventoryAuditActions)[keyof typeof InventoryAuditActions]

/** Canonical prediction / forecast-run audit action codes (docs/10). */
export const PredictionAuditActions = {
  RUN: 'prediction.run',
} as const

export type PredictionAuditAction =
  (typeof PredictionAuditActions)[keyof typeof PredictionAuditActions]

/** Canonical shortage-alert audit action codes (docs/10 — alert status changes). */
export const AlertAuditActions = {
  STATUS_CHANGE: 'alert.status_change',
  RECALCULATE: 'alert.recalculate',
  /** Optional: authorized user viewed on-demand donor matches for an alert. */
  MATCHES_VIEWED: 'alert.matches_viewed',
} as const

export type AlertAuditAction =
  (typeof AlertAuditActions)[keyof typeof AlertAuditActions]

/** Canonical notification audit action codes (docs/09, docs/10 — sent notifications). */
export const NotificationAuditActions = {
  PREVIEW: 'notification.preview',
  SEND: 'notification.send',
} as const

export type NotificationAuditAction =
  (typeof NotificationAuditActions)[keyof typeof NotificationAuditActions]
