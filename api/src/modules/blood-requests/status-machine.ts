/**
 * Blood request status transitions (docs/04 statuses; docs/12 status rules).
 *
 * Docs list states but not edges — this module is the API authority:
 *
 *   PENDING  → APPROVED | CANCELLED
 *   APPROVED → PARTIAL | FULFILLED | CANCELLED
 *   PARTIAL  → PARTIAL | FULFILLED | CANCELLED  (PARTIAL→PARTIAL bumps fulfilled units)
 *   FULFILLED → (terminal)
 *   CANCELLED → (terminal)
 */

import type { BloodRequestStatus } from '../../db/schema/enums'
import { AppError } from '../../lib/errors'

/** Allowed next statuses keyed by current status. */
export const BLOOD_REQUEST_TRANSITIONS: Record<
  BloodRequestStatus,
  readonly BloodRequestStatus[]
> = {
  PENDING: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PARTIAL', 'FULFILLED', 'CANCELLED'],
  PARTIAL: ['PARTIAL', 'FULFILLED', 'CANCELLED'],
  FULFILLED: [],
  CANCELLED: [],
} as const

export type TransitionContext = {
  unitsRequested: number
  currentFulfilledUnits: number
  /** Next fulfilled units when provided on PATCH; otherwise current. */
  nextFulfilledUnits?: number
}

export type TransitionResult = {
  status: BloodRequestStatus
  fulfilledUnits: number
}

export function isTerminalStatus(status: BloodRequestStatus): boolean {
  return (
    BLOOD_REQUEST_TRANSITIONS[status]?.length === 0 ||
    BLOOD_REQUEST_TRANSITIONS[status] === undefined
  )
}

export function canTransition(
  from: BloodRequestStatus,
  to: BloodRequestStatus,
): boolean {
  const allowed = BLOOD_REQUEST_TRANSITIONS[from] ?? []
  return allowed.includes(to)
}

/**
 * Validate and resolve the next status + fulfilledUnits.
 * Throws AppError.conflict on illegal transitions; AppError.validation on unit rules.
 */
export function assertStatusTransition(
  from: BloodRequestStatus,
  to: BloodRequestStatus,
  context: TransitionContext,
): TransitionResult {
  if (!canTransition(from, to)) {
    throw AppError.conflict(
      `Cannot transition blood request from ${from} to ${to}`,
      [
        {
          path: 'status',
          message: `Transition ${from} → ${to} is not allowed`,
          code: 'invalid_status_transition',
        },
      ],
    )
  }

  const unitsRequested = context.unitsRequested
  const currentFulfilled = context.currentFulfilledUnits ?? 0
  const nextFulfilled =
    context.nextFulfilledUnits !== undefined
      ? context.nextFulfilledUnits
      : currentFulfilled

  if (!Number.isFinite(unitsRequested) || unitsRequested < 1) {
    throw AppError.validation('Invalid units requested', [
      {
        path: 'unitsRequested',
        message: 'Units requested must be a positive integer',
        code: 'invalid_units_requested',
      },
    ])
  }

  if (!Number.isInteger(nextFulfilled) || nextFulfilled < 0) {
    throw AppError.validation('Invalid fulfilled units', [
      {
        path: 'fulfilledUnits',
        message: 'Fulfilled units must be a non-negative integer',
        code: 'invalid_fulfilled_units',
      },
    ])
  }

  if (to === 'APPROVED' || to === 'CANCELLED') {
    if (
      context.nextFulfilledUnits !== undefined &&
      context.nextFulfilledUnits !== currentFulfilled
    ) {
      throw AppError.validation(
        'Fulfilled units cannot change when approving or cancelling',
        [
          {
            path: 'fulfilledUnits',
            message: 'Omit fulfilledUnits for APPROVED or CANCELLED',
            code: 'fulfilled_units_not_allowed',
          },
        ],
      )
    }
    return { status: to, fulfilledUnits: currentFulfilled }
  }

  if (to === 'PARTIAL') {
    if (context.nextFulfilledUnits === undefined) {
      throw AppError.validation('Fulfilled units required for PARTIAL', [
        {
          path: 'fulfilledUnits',
          message: 'fulfilledUnits is required when status is PARTIAL',
          code: 'fulfilled_units_required',
        },
      ])
    }
    if (nextFulfilled <= 0 || nextFulfilled >= unitsRequested) {
      throw AppError.validation(
        'PARTIAL requires fulfilledUnits between 1 and unitsRequested - 1',
        [
          {
            path: 'fulfilledUnits',
            message: `Expected 1..${unitsRequested - 1}, got ${nextFulfilled}`,
            code: 'invalid_partial_units',
          },
        ],
      )
    }
    return { status: to, fulfilledUnits: nextFulfilled }
  }

  // FULFILLED
  const fulfilledForComplete =
    context.nextFulfilledUnits !== undefined
      ? context.nextFulfilledUnits
      : unitsRequested

  if (fulfilledForComplete !== unitsRequested) {
    throw AppError.validation(
      'FULFILLED requires fulfilledUnits to equal unitsRequested',
      [
        {
          path: 'fulfilledUnits',
          message: `Expected ${unitsRequested}, got ${fulfilledForComplete}`,
          code: 'invalid_fulfilled_units',
        },
      ],
    )
  }

  return { status: 'FULFILLED', fulfilledUnits: unitsRequested }
}
