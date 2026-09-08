/**
 * Hook points for shortage-alerts (TODO.md §7).
 *
 * Production wiring lives in `modules/alerts` (`afterPredictionPersisted`)
 * and is passed from prediction routes into `runPrediction` deps.
 * This module keeps the type + noop so predictions stays decoupled.
 */

import type { ForecastResponse } from '../../services/ai/types'
import type { PublicPrediction } from './serialize'

export type AfterPredictionPersistedContext = {
  prediction: PublicPrediction
  forecast: ForecastResponse
  bloodGroupId: number
  facilityId: number | null
}

/**
 * Invoked after a forecast row is persisted.
 * Default: no-op. Shortage-alerts replaces this via runPrediction deps.
 * Failures must not fail the prediction run (handled in runPrediction).
 */
export type AfterPredictionPersistedHook = (
  ctx: AfterPredictionPersistedContext,
) => Promise<void>

export const noopAfterPredictionPersisted: AfterPredictionPersistedHook =
  async () => {
    // Intentionally empty — production uses modules/alerts afterPredictionPersisted.
  }
