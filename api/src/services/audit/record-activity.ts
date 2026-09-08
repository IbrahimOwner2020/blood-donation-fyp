/**
 * Activity log writer — persists audit events to `activity_logs` via getDb().
 * Failures are logged and swallowed so business flows are never blocked.
 */

import { getDb } from '../../db'
import { activityLogs } from '../../db/schema/activity-logs'
import { logWarn } from '../../lib/logger'
import { buildActivityMetadata } from './redact-metadata'
import type {
  ActivityLogInsertRow,
  RecordActivityDeps,
  RecordActivityInput,
} from './types'

function normalizeEntityId(
  entityId: string | number | null | undefined,
): string | null {
  if (entityId === null || entityId === undefined) {
    return null
  }
  const asString = String(entityId).trim()
  return asString.length > 0 ? asString.slice(0, 64) : null
}

function normalizeAction(action: string): string {
  return action.trim().slice(0, 120)
}

function normalizeEntityType(entityType: string): string {
  return entityType.trim().slice(0, 120)
}

function normalizeIp(ipAddress: string | null | undefined): string | null {
  const raw = ipAddress?.trim()
  if (!raw) {
    return null
  }
  return raw.slice(0, 45)
}

async function defaultInsert(row: ActivityLogInsertRow, deps: RecordActivityDeps): Promise<void> {
  const db = deps.db ?? getDb()
  await db.insert(activityLogs).values({
    userId: row.userId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadataJson: row.metadataJson,
    ipAddress: row.ipAddress,
  })
}

/**
 * Record an activity / audit event.
 *
 * @example
 * await recordActivity({
 *   actorUserId: user.id,
 *   action: 'auth.login_success',
 *   entityType: 'user',
 *   entityId: user.id,
 *   requestId: c.get('requestId'),
 *   ipAddress: '127.0.0.1',
 * })
 */
export async function recordActivity(
  input: RecordActivityInput,
  deps: RecordActivityDeps = {},
): Promise<void> {
  const action = normalizeAction(input?.action ?? '')
  const entityType = normalizeEntityType(input?.entityType ?? '')

  if (!action || !entityType) {
    logWarn('audit.record_skipped', {
      reason: 'missing_action_or_entity_type',
    })
    return
  }

  const row: ActivityLogInsertRow = {
    userId:
      typeof input.actorUserId === 'number' && Number.isFinite(input.actorUserId)
        ? input.actorUserId
        : null,
    action,
    entityType,
    entityId: normalizeEntityId(input.entityId),
    metadataJson: buildActivityMetadata(input.metadata, input.requestId),
    ipAddress: normalizeIp(input.ipAddress),
  }

  try {
    if (deps.insert) {
      await deps.insert(row)
      return
    }
    await defaultInsert(row, deps)
  } catch (error) {
    logWarn('audit.record_failed', {
      action: row.action,
      entityType: row.entityType,
      message: error instanceof Error ? error.message : 'unknown',
    })
  }
}
