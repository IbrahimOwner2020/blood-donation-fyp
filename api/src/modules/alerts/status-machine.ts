/**
 * Shortage alert lifecycle transitions (docs/08).
 *
 *   OPEN          → ACKNOWLEDGED | RESOLVED | DISMISSED
 *   ACKNOWLEDGED  → RESOLVED | DISMISSED
 *   RESOLVED      → (terminal)
 *   DISMISSED     → (terminal)
 */

import type { AlertStatus } from '../../db/schema/enums'
import { AppError } from '../../lib/errors'

/** Allowed next statuses keyed by current status. */
export const ALERT_STATUS_TRANSITIONS: Record<
  AlertStatus,
  readonly AlertStatus[]
> = {
  OPEN: ['ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'],
  ACKNOWLEDGED: ['RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
} as const

/** Statuses that count as "active" for upsert / auto-resolve. */
export const ACTIVE_ALERT_STATUSES: readonly AlertStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
] as const

export function isTerminalAlertStatus(status: AlertStatus): boolean {
  return (ALERT_STATUS_TRANSITIONS[status] ?? []).length === 0
}

export function isActiveAlertStatus(status: AlertStatus): boolean {
  return ACTIVE_ALERT_STATUSES.includes(status)
}

export function canTransitionAlertStatus(
  from: AlertStatus,
  to: AlertStatus,
): boolean {
  const allowed = ALERT_STATUS_TRANSITIONS[from] ?? []
  return allowed.includes(to)
}

/**
 * Validate alert status transition.
 * Throws AppError.conflict on illegal transitions.
 */
export function assertAlertStatusTransition(
  from: AlertStatus,
  to: AlertStatus,
): AlertStatus {
  if (from === to) {
    throw AppError.conflict(
      `Alert is already ${from}`,
      [
        {
          path: 'status',
          message: `Status is already ${from}`,
          code: 'status_unchanged',
        },
      ],
    )
  }

  if (!canTransitionAlertStatus(from, to)) {
    throw AppError.conflict(
      `Cannot transition alert from ${from} to ${to}`,
      [
        {
          path: 'status',
          message: `Transition ${from} → ${to} is not allowed`,
          code: 'invalid_status_transition',
        },
      ],
    )
  }

  return to
}

/** RESOLVED and DISMISSED stamp resolvedAt. */
export function shouldStampResolvedAt(status: AlertStatus): boolean {
  return status === 'RESOLVED' || status === 'DISMISSED'
}
