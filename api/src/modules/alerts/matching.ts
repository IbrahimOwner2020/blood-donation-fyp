/**
 * Donor-matching hook after alert upsert (docs/08, TODO.md §7).
 *
 * On-demand matching lives in matching-service / GET /alerts/:id/matches.
 * This hook only logs match count (no PII, no notifications).
 */

import { getDb } from '../../db'
import { logInfo, logWarn } from '../../lib/logger'
import type { PublicAlert } from './serialize'
import type { UpsertAlertResult } from './service'
import { countMatchesForBloodGroup } from './matching-service'

export type AfterAlertUpsertedContext = {
  result: UpsertAlertResult
  alert: PublicAlert | null
}

/**
 * Invoked after an alert is created/updated/auto-resolved from a prediction.
 * Must not send notifications — authorized users review matches first.
 */
export type AfterAlertUpsertedHook = (
  ctx: AfterAlertUpsertedContext,
) => Promise<void>

export const noopAfterAlertUpserted: AfterAlertUpsertedHook = async () => {
  // Intentionally empty — tests / opt-out.
}

export type LogMatchCountHookDeps = {
  countMatches?: (
    bloodGroupId: number,
  ) => Promise<number>
}

/**
 * Light hook: count potentially eligible donors for the alert blood group
 * and log the count only (no donor identities or contact fields).
 */
export function createLogMatchCountAfterAlertUpserted(
  deps: LogMatchCountHookDeps = {},
): AfterAlertUpsertedHook {
  return async (ctx: AfterAlertUpsertedContext) => {
    const alert = ctx?.alert ?? ctx?.result?.alert ?? null
    const bloodGroupId = alert?.bloodGroupId
    const alertId = alert?.id ?? null
    const action = ctx?.result?.action ?? 'noop'

    if (
      typeof bloodGroupId !== 'number' ||
      !Number.isFinite(bloodGroupId) ||
      bloodGroupId <= 0
    ) {
      return
    }

    // Skip count work when upsert was a no-op with no alert payload.
    if (action === 'noop' && !alert) {
      return
    }

    try {
      const countMatches =
        deps.countMatches ??
        ((id: number) => countMatchesForBloodGroup(getDb(), id))

      const matchCount = await countMatches(bloodGroupId)

      logInfo('donor matching count after alert upsert', {
        alertId,
        bloodGroupId,
        upsertAction: action,
        matchCount,
        // Explicit: hook never sends notifications.
        notificationsSent: false,
      })
    } catch (error) {
      logWarn('donor matching count after alert upsert failed (non-fatal)', {
        alertId,
        bloodGroupId,
        reason:
          error instanceof Error ? error.message : 'unknown match count failure',
      })
    }
  }
}

/** Default production hook — log match count only. */
export const logMatchCountAfterAlertUpserted: AfterAlertUpsertedHook =
  createLogMatchCountAfterAlertUpserted()
