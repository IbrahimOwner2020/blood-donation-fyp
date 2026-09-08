/**
 * Notification routes (docs/04 notifications/, docs/09, TODO.md §8).
 * Mounted under /api/v1/notifications.
 *
 * Permissions (docs/10):
 * - GET list / :id → notifications:read
 * - POST /preview → notifications:read (compose only; no send)
 * - POST /send → notifications:send
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { AppError } from '../../lib/errors'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import {
  NotificationAuditActions,
  recordActivity,
} from '../../services/audit'
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
  previewNotificationsBodySchema,
  sendNotificationsBodySchema,
} from './schemas'
import {
  getNotificationById,
  listNotifications,
  previewNotifications,
  sendNotifications,
} from './service'

export { NotificationAuditActions }
export type { NotificationAuditAction } from '../../services/audit'

function clientIp(c: {
  req: { header: (name: string) => string | undefined }
}): string | null {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    return first || null
  }
  return c.req.header('x-real-ip')?.trim() || null
}

export const notificationRoutes = new Hono<AppHonoEnv>()

notificationRoutes.use('*', requireAuth)

/**
 * GET /notifications
 * Query: donorId? | alertId? | channel? | status? | limit? | offset?
 */
notificationRoutes.get(
  '/',
  requirePermission('notifications:read'),
  async (c) => {
    const query = parseQuery(c, listNotificationsQuerySchema)
    const result = await listNotifications(getDb(), query)
    return jsonOk(c, {
      notifications: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    })
  },
)

/**
 * POST /notifications/preview
 * Compose messages for selected donors — no send, no persistence (docs/09).
 * Must be registered before /:id.
 */
notificationRoutes.post(
  '/preview',
  requirePermission('notifications:read'),
  async (c) => {
    const body = await parseJsonBody(c, previewNotificationsBodySchema)
    const actor = c.get('user')
    const result = await previewNotifications(getDb(), body)

    await recordActivity({
      actorUserId: actor?.id ?? null,
      action: NotificationAuditActions.PREVIEW,
      entityType: 'notification',
      entityId: null,
      metadata: {
        channel: result.channel,
        alertId: result.alertId,
        donorCount: body.donorIds?.length ?? 0,
        composedCount: result.composedCount,
        skippedCount: result.skippedCount,
        // Redacted destinations only — never full phone/email in audit logs.
        recipientsRedacted: result.previews
          .map((p) => p.recipientRedacted)
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .join(','),
      },
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    })

    return jsonOk(c, {
      channel: result.channel,
      alertId: result.alertId,
      previews: result.previews,
      composedCount: result.composedCount,
      skippedCount: result.skippedCount,
    })
  },
)

/**
 * POST /notifications/send
 * Permissioned send via providers; persists PENDING → SENT|FAILED (docs/09).
 * Must be registered before /:id.
 */
notificationRoutes.post(
  '/send',
  requirePermission('notifications:send'),
  async (c) => {
    const body = await parseJsonBody(c, sendNotificationsBodySchema)
    const actor = c.get('user')
    if (!actor?.id) {
      throw AppError.unauthorized('Authenticated user required')
    }

    const result = await sendNotifications(getDb(), body, actor.id)

    await recordActivity({
      actorUserId: actor.id,
      action: NotificationAuditActions.SEND,
      entityType: 'notification',
      entityId: null,
      metadata: {
        channel: result.channel,
        alertId: result.alertId,
        donorCount: body.donorIds?.length ?? 0,
        sentCount: result.sentCount,
        failedCount: result.failedCount,
        skippedCount: result.skippedCount,
        recipientsRedacted: result.results
          .map((r) => r.recipientRedacted)
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .join(','),
        notificationIds: result.results
          .map((r) => r.notification?.id)
          .filter((id): id is number => typeof id === 'number')
          .join(','),
      },
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    })

    return jsonOk(c, {
      channel: result.channel,
      alertId: result.alertId,
      results: result.results,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      skippedCount: result.skippedCount,
    })
  },
)

/**
 * GET /notifications/:id
 */
notificationRoutes.get(
  '/:id',
  requirePermission('notifications:read'),
  async (c) => {
    const { id } = parseParams(c, notificationIdParamSchema)
    const notification = await getNotificationById(getDb(), id)
    return jsonOk(c, { notification })
  },
)
