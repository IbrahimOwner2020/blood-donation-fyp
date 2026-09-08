/**
 * Inventory status transitions (docs/06 statuses; API authority for edges).
 *
 *   AVAILABLE → RESERVED | ISSUED | EXPIRED | DISCARDED
 *   RESERVED  → AVAILABLE | ISSUED | EXPIRED | DISCARDED
 *   EXPIRED   → DISCARDED
 *   ISSUED    → (terminal)
 *   DISCARDED → (terminal)
 */

import type { InventoryStatus } from '../../db/schema/enums'
import { AppError } from '../../lib/errors'

export const INVENTORY_STATUS_TRANSITIONS: Record<
  InventoryStatus,
  readonly InventoryStatus[]
> = {
  AVAILABLE: ['RESERVED', 'ISSUED', 'EXPIRED', 'DISCARDED'],
  RESERVED: ['AVAILABLE', 'ISSUED', 'EXPIRED', 'DISCARDED'],
  EXPIRED: ['DISCARDED'],
  ISSUED: [],
  DISCARDED: [],
} as const

export function isTerminalInventoryStatus(status: InventoryStatus): boolean {
  return (INVENTORY_STATUS_TRANSITIONS[status] ?? []).length === 0
}

export function canTransitionInventoryStatus(
  from: InventoryStatus,
  to: InventoryStatus,
): boolean {
  if (from === to) {
    return true
  }
  const allowed = INVENTORY_STATUS_TRANSITIONS[from] ?? []
  return allowed.includes(to)
}

export function assertInventoryStatusTransition(
  from: InventoryStatus,
  to: InventoryStatus,
): InventoryStatus {
  if (!canTransitionInventoryStatus(from, to)) {
    throw AppError.conflict(
      `Cannot transition inventory status from ${from} to ${to}`,
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
