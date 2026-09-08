/**
 * Optional Hono helper — wrap a handler to record an audit event after success.
 * Prefer direct `recordActivity` calls at clear touch points; use this when
 * wiring many routes without editing each handler body heavily.
 */

import type { Context, Next } from 'hono'
import type { MiddlewareHandler } from 'hono/types'

import type { AppHonoEnv } from '../../lib/types'
import type { ActivityMetadata } from '../../db/schema/activity-logs'
import { recordActivity } from './record-activity'

export type WithAuditOptions = {
  action: string
  entityType: string
  /** Resolve entity id from context after the handler runs. */
  entityId?: (
    c: Context<AppHonoEnv>,
  ) => string | number | null | undefined
  /** Extra metadata (will be redacted). */
  metadata?: (
    c: Context<AppHonoEnv>,
  ) => ActivityMetadata | Record<string, unknown> | null | undefined
  /** Skip recording when false (e.g. failed auth). Default: always record. */
  when?: (c: Context<AppHonoEnv>) => boolean
  /** Prefer actor from context user; override if needed. */
  actorUserId?: (
    c: Context<AppHonoEnv>,
  ) => number | null | undefined
  ipAddress?: (
    c: Context<AppHonoEnv>,
  ) => string | null | undefined
}

function defaultIp(c: Context<AppHonoEnv>): string | null {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    return first || null
  }
  return c.req.header('x-real-ip')?.trim() || null
}

/**
 * Middleware factory: runs `next()`, then records activity if status < 400
 * (or when `when` returns true).
 */
export function withAudit(options: WithAuditOptions): MiddlewareHandler<AppHonoEnv> {
  return async (c: Context<AppHonoEnv>, next: Next) => {
    await next()

    const shouldRecord =
      typeof options.when === 'function'
        ? options.when(c)
        : c.res.status < 400

    if (!shouldRecord) {
      return
    }

    const user = c.get('user')
    const actorFromOptions = options.actorUserId?.(c)
    const actorUserId =
      typeof actorFromOptions === 'number'
        ? actorFromOptions
        : (user?.id ?? null)

    await recordActivity({
      actorUserId,
      action: options.action,
      entityType: options.entityType,
      entityId: options.entityId?.(c) ?? null,
      metadata: options.metadata?.(c) ?? null,
      requestId: c.get('requestId') ?? null,
      ipAddress: options.ipAddress?.(c) ?? defaultIp(c),
    })
  }
}
