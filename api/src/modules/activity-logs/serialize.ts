/**
 * Public activity-log DTOs. Metadata is re-redacted on read (defense in depth).
 */

import type { ActivityMetadata } from '../../db/schema/activity-logs'
import { redactActivityMetadata } from '../../services/audit'

export type ActivityLogRow = {
  id: number
  userId: number | null
  action: string
  entityType: string
  entityId: string | null
  metadataJson: ActivityMetadata | null
  ipAddress: string | null
  createdAt: Date
}

export type ActorJoinRow = {
  id: number
  name: string
}

export type PublicActivityLog = {
  id: number
  userId: number | null
  /** Display name of the actor when the user row still exists; never email. */
  actorName: string | null
  action: string
  entityType: string
  entityId: string | null
  metadata: ActivityMetadata | null
  ipAddress: string | null
  createdAt: Date
}

/**
 * Normalize metadata for API responses — always re-apply redaction.
 */
export function toPublicActivityMetadata(
  metadata: ActivityMetadata | Record<string, unknown> | null | undefined,
): ActivityMetadata | null {
  return redactActivityMetadata(metadata)
}

export function toPublicActivityLog(
  row: ActivityLogRow | null | undefined,
  actor: ActorJoinRow | null | undefined = null,
): PublicActivityLog | null {
  if (!row?.id) {
    return null
  }

  const userId =
    typeof row.userId === 'number' && Number.isFinite(row.userId)
      ? row.userId
      : null

  const actorName =
    actor?.id && typeof actor.name === 'string' && actor.name.trim().length > 0
      ? actor.name.trim()
      : null

  return {
    id: row.id,
    userId,
    actorName,
    action: row.action?.trim() || '',
    entityType: row.entityType?.trim() || '',
    entityId: row.entityId?.trim() || null,
    metadata: toPublicActivityMetadata(row.metadataJson),
    ipAddress: row.ipAddress?.trim() || null,
    createdAt: row.createdAt,
  }
}
