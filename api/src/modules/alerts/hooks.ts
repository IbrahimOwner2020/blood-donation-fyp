/**
 * Prediction → shortage-alert bridge (TODO.md §7, docs/08).
 *
 * Wired into `runPrediction` via `afterPredictionPersisted`.
 * Failures are non-fatal at the prediction layer (logged there).
 *
 * Donor matching hook logs match count only — see matching.ts (no auto-send).
 */

import { getDb } from '../../db'
import { logWarn } from '../../lib/logger'
import type {
  AfterPredictionPersistedContext,
  AfterPredictionPersistedHook,
} from '../predictions/hooks'
import {
  logMatchCountAfterAlertUpserted,
  type AfterAlertUpsertedHook,
} from './matching'
import { upsertAlertFromShortage } from './service'

export type AlertHookDeps = {
  afterAlertUpserted?: AfterAlertUpsertedHook
}

/**
 * Build the predictions hook that upserts shortage alerts from inventory gap.
 */
export function createAfterPredictionPersisted(
  deps: AlertHookDeps = {},
): AfterPredictionPersistedHook {
  const afterAlertUpserted =
    deps.afterAlertUpserted ?? logMatchCountAfterAlertUpserted

  return async (ctx: AfterPredictionPersistedContext) => {
    const predictedUnits = ctx.prediction?.predictedUnits ?? 0
    const predictionId = ctx.prediction?.id
    if (typeof predictionId !== 'number' || !Number.isFinite(predictionId)) {
      throw new Error('afterPredictionPersisted: missing prediction id')
    }

    const result = await upsertAlertFromShortage(getDb(), {
      predictionId,
      bloodGroupId: ctx.bloodGroupId,
      facilityId: ctx.facilityId ?? null,
      predictedUnits,
    })

    try {
      await afterAlertUpserted({
        result,
        alert: result.alert,
      })
    } catch (error) {
      logWarn('afterAlertUpserted matching hook failed (non-fatal)', {
        alertId: result.alert?.id ?? null,
        predictionId,
        reason:
          error instanceof Error ? error.message : 'unknown matching failure',
      })
    }
  }
}

/** Default production hook — gap upsert + match-count log (no notifications). */
export const afterPredictionPersisted: AfterPredictionPersistedHook =
  createAfterPredictionPersisted()
