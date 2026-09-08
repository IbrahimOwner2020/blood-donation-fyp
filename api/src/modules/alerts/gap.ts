/**
 * Pure shortage gap + severity helpers (docs/08).
 *
 * projected_gap = predicted_demand - expected_available_supply
 *
 * Severity is configuration-driven; null severity means no shortage alert
 * (docs INFO / monitoring-only — schema has no INFO enum value).
 */

import type { AlertSeverity } from '../../db/schema/enums'
import {
  DEFAULT_SHORTAGE_THRESHOLDS,
  type ShortageSeverityThresholds,
} from './thresholds'

export type GapComputationInput = {
  predictedDemand: number
  availableSupply: number
}

export type GapComputationResult = {
  predictedUnits: number
  availableUnits: number
  /** Raw gap (may be negative when supply exceeds demand). */
  projectedGap: number
  /**
   * Severity for alert upsert, or null when gap is below LOW threshold
   * (no shortage / monitoring only).
   */
  severity: AlertSeverity | null
}

/**
 * projected_gap = predicted_demand - expected_available_supply
 * Non-finite inputs coerce to 0; supply/demand floored at 0.
 */
export function computeProjectedGap(
  predictedDemand: number,
  availableSupply: number,
): number {
  const predicted =
    typeof predictedDemand === 'number' && Number.isFinite(predictedDemand)
      ? Math.max(0, predictedDemand)
      : 0
  const available =
    typeof availableSupply === 'number' && Number.isFinite(availableSupply)
      ? Math.max(0, availableSupply)
      : 0
  return predicted - available
}

/**
 * Map absolute projected gap to severity using thresholds.
 * Returns null when gap is below lowMin (no OPEN alert warranted).
 */
export function resolveShortageSeverity(
  projectedGap: number,
  thresholds: ShortageSeverityThresholds = DEFAULT_SHORTAGE_THRESHOLDS,
): AlertSeverity | null {
  const gap =
    typeof projectedGap === 'number' && Number.isFinite(projectedGap)
      ? projectedGap
      : 0

  if (gap < thresholds.lowMin) {
    return null
  }
  if (gap >= thresholds.criticalMin) {
    return 'CRITICAL'
  }
  if (gap >= thresholds.highMin) {
    return 'HIGH'
  }
  if (gap >= thresholds.mediumMin) {
    return 'MEDIUM'
  }
  return 'LOW'
}

/** Compute gap + severity in one pass for upsert / recalculate paths. */
export function computeShortageGap(
  input: GapComputationInput,
  thresholds: ShortageSeverityThresholds = DEFAULT_SHORTAGE_THRESHOLDS,
): GapComputationResult {
  const predictedUnits =
    typeof input?.predictedDemand === 'number' &&
    Number.isFinite(input.predictedDemand)
      ? Math.max(0, input.predictedDemand)
      : 0
  const availableUnits =
    typeof input?.availableSupply === 'number' &&
    Number.isFinite(input.availableSupply)
      ? Math.max(0, input.availableSupply)
      : 0
  const projectedGap = computeProjectedGap(predictedUnits, availableUnits)
  const severity = resolveShortageSeverity(projectedGap, thresholds)

  return {
    predictedUnits,
    availableUnits,
    projectedGap,
    severity,
  }
}
