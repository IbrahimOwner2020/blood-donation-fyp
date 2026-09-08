/**
 * Redact sensitive keys from activity metadata before persistence.
 * Reuses logger redaction rules; coerces to ActivityMetadata (flat primitives).
 */

import type { ActivityMetadata } from '../../db/schema/activity-logs'
import { redactSensitive } from '../../lib/logger'

function isPrimitiveMetaValue(
  value: unknown,
): value is string | number | boolean | null | undefined {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

/**
 * Returns a flat, redacted metadata object safe for activity_logs.metadata_json.
 * Sensitive keys become `[REDACTED]`. Nested objects/arrays are dropped.
 */
export function redactActivityMetadata(
  metadata: ActivityMetadata | Record<string, unknown> | null | undefined,
  extraSensitiveKeys: string[] = [],
): ActivityMetadata | null {
  if (metadata == null) {
    return null
  }

  const redacted = redactSensitive(metadata, extraSensitiveKeys)
  if (redacted == null || typeof redacted !== 'object' || Array.isArray(redacted)) {
    return null
  }

  const output: ActivityMetadata = {}
  for (const [key, value] of Object.entries(
    redacted as Record<string, unknown>,
  )) {
    if (!isPrimitiveMetaValue(value)) {
      continue
    }
    output[key] = value
  }

  return Object.keys(output).length > 0 ? output : null
}

/**
 * Merge optional requestId into metadata (after redaction of caller fields).
 */
export function buildActivityMetadata(
  metadata: ActivityMetadata | Record<string, unknown> | null | undefined,
  requestId?: string | null,
  extraSensitiveKeys: string[] = [],
): ActivityMetadata | null {
  const base = redactActivityMetadata(metadata, extraSensitiveKeys) ?? {}
  const rid = requestId?.trim()
  if (rid) {
    base.requestId = rid
  }
  return Object.keys(base).length > 0 ? base : null
}
