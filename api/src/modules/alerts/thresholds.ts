/**
 * Configurable shortage severity thresholds (docs/08, docs/15).
 * API owns business thresholds — defaults here, overrides via env.
 *
 * Severity ladder (absolute projected gap in units):
 *   gap < lowMin              → no alert (monitoring / INFO)
 *   lowMin   ≤ gap < medium   → LOW
 *   medium   ≤ gap < high     → MEDIUM
 *   high     ≤ gap < critical → HIGH
 *   gap ≥ critical            → CRITICAL
 */

import { getEnv } from '../../lib/env'

export type ShortageSeverityThresholds = {
  /** Minimum gap (units) that creates a LOW alert. */
  lowMin: number
  /** Minimum gap for MEDIUM. */
  mediumMin: number
  /** Minimum gap for HIGH. */
  highMin: number
  /** Minimum gap for CRITICAL. */
  criticalMin: number
}

/** Prototype defaults — positive gap starts LOW; escalate by absolute units. */
export const DEFAULT_SHORTAGE_THRESHOLDS: ShortageSeverityThresholds = {
  lowMin: 0.01,
  mediumMin: 10,
  highMin: 25,
  criticalMin: 50,
}

/**
 * Validate and normalize threshold ordering.
 * Ensures low ≤ medium ≤ high ≤ critical (raises floors if misconfigured).
 */
export function normalizeShortageThresholds(
  input: Partial<ShortageSeverityThresholds> | null | undefined,
): ShortageSeverityThresholds {
  const base = DEFAULT_SHORTAGE_THRESHOLDS
  let lowMin =
    typeof input?.lowMin === 'number' && Number.isFinite(input.lowMin)
      ? Math.max(0, input.lowMin)
      : base.lowMin
  let mediumMin =
    typeof input?.mediumMin === 'number' && Number.isFinite(input.mediumMin)
      ? Math.max(0, input.mediumMin)
      : base.mediumMin
  let highMin =
    typeof input?.highMin === 'number' && Number.isFinite(input.highMin)
      ? Math.max(0, input.highMin)
      : base.highMin
  let criticalMin =
    typeof input?.criticalMin === 'number' &&
    Number.isFinite(input.criticalMin)
      ? Math.max(0, input.criticalMin)
      : base.criticalMin

  if (mediumMin < lowMin) {
    mediumMin = lowMin
  }
  if (highMin < mediumMin) {
    highMin = mediumMin
  }
  if (criticalMin < highMin) {
    criticalMin = highMin
  }

  return { lowMin, mediumMin, highMin, criticalMin }
}

/** Load thresholds from cached app env (ALERT_SEVERITY_*). */
export function loadShortageThresholdsFromEnv(): ShortageSeverityThresholds {
  const env = getEnv()
  return normalizeShortageThresholds({
    lowMin: env.ALERT_SEVERITY_LOW_MIN,
    mediumMin: env.ALERT_SEVERITY_MEDIUM_MIN,
    highMin: env.ALERT_SEVERITY_HIGH_MIN,
    criticalMin: env.ALERT_SEVERITY_CRITICAL_MIN,
  })
}
