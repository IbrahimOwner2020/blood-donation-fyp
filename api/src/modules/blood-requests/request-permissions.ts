/**
 * Permission requirements for blood-request status transitions.
 * Approve/cancel need requests:approve; fulfilment needs requests:issue.
 */

import type { BloodRequestStatus } from '../../db/schema/enums'
import { AppError } from '../../lib/errors'
import { hasAnyPermission } from '../auth/user-access'

export const REQUEST_APPROVE_PERMISSION = 'requests:approve' as const
export const REQUEST_ISSUE_PERMISSION = 'requests:issue' as const

export const REQUEST_STATUS_MUTATION_PERMISSIONS = [
  REQUEST_APPROVE_PERMISSION,
  REQUEST_ISSUE_PERMISSION,
] as const

/** Statuses that require requests:approve. */
export const APPROVE_PERMISSION_STATUSES: readonly BloodRequestStatus[] = [
  'APPROVED',
  'CANCELLED',
]

/** Statuses that require requests:issue. */
export const ISSUE_PERMISSION_STATUSES: readonly BloodRequestStatus[] = [
  'PARTIAL',
  'FULFILLED',
]

export function permissionForRequestStatus(
  nextStatus: BloodRequestStatus,
): typeof REQUEST_APPROVE_PERMISSION | typeof REQUEST_ISSUE_PERMISSION {
  if (APPROVE_PERMISSION_STATUSES.includes(nextStatus)) {
    return REQUEST_APPROVE_PERMISSION
  }
  if (ISSUE_PERMISSION_STATUSES.includes(nextStatus)) {
    return REQUEST_ISSUE_PERMISSION
  }
  throw AppError.validation('Unsupported blood request status', [
    {
      path: 'status',
      message: `Status ${nextStatus} is not a mutable blood request status`,
      code: 'invalid_status',
    },
  ])
}

/**
 * Ensure the actor may apply the given next status.
 * Throws AppError.forbidden when the matching permission is missing.
 */
export function assertBloodRequestStatusPermission(
  granted: readonly string[] | null | undefined,
  nextStatus: BloodRequestStatus,
): void {
  const required = permissionForRequestStatus(nextStatus)
  if (!hasAnyPermission(granted, [required])) {
    throw AppError.forbidden(
      `Insufficient permissions: ${required} is required to set status ${nextStatus}`,
    )
  }
}

/** True when the actor can mutate request status at all (approve and/or issue). */
export function canMutateBloodRequestStatus(
  granted: readonly string[] | null | undefined,
): boolean {
  return hasAnyPermission(granted, REQUEST_STATUS_MUTATION_PERMISSIONS)
}
