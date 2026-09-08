/**
 * Shortage alert routes (docs/04 alerts/, TODO.md §7, docs/08 lifecycle).
 * Mounted under /api/v1/alerts.
 *
 * Permissions (docs/10):
 * - GET list / :id → alerts:read
 * - GET /:id/matches → alerts:read + donors:read (on-demand matching)
 * - PATCH /:id/status → alerts:update
 * - POST /recalculate → alerts:update
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import { AlertAuditActions, recordActivity } from '../../services/audit'
import { listMatchesForAlert } from './matching-service'
import {
  alertIdParamSchema,
  listAlertMatchesQuerySchema,
  listAlertsQuerySchema,
  patchAlertStatusBodySchema,
  recalculateAlertsBodySchema,
} from './schemas'
import {
  getAlertById,
  listAlerts,
  patchAlertStatus,
  recalculateAlerts,
} from './service'

export { AlertAuditActions }
export type { AlertAuditAction } from '../../services/audit'

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

export const alertRoutes = new Hono<AppHonoEnv>()

alertRoutes.use('*', requireAuth)

/**
 * GET /alerts
 * Query: bloodGroupId? | bloodGroup?, facilityId?, status?, severity?,
 *        activeOnly?, limit?, offset?
 */
alertRoutes.get('/', requirePermission('alerts:read'), async (c) => {
  const query = parseQuery(c, listAlertsQuerySchema)
  const result = await listAlerts(getDb(), query)
  return jsonOk(c, {
    alerts: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  })
})

/**
 * POST /alerts/recalculate
 * Body: predictionId? | bloodGroupId? | bloodGroup?, facilityId?
 * Must be registered before /:id.
 */
alertRoutes.post(
  '/recalculate',
  requirePermission('alerts:update'),
  async (c) => {
    const body = await parseJsonBody(c, recalculateAlertsBodySchema)
    const actor = c.get('user')
    const result = await recalculateAlerts(getDb(), body)

    await recordActivity({
      actorUserId: actor?.id ?? null,
      action: AlertAuditActions.RECALCULATE,
      entityType: 'shortage_alert',
      entityId: null,
      metadata: {
        predictionId: body.predictionId ?? null,
        bloodGroupId: body.bloodGroupId ?? null,
        bloodGroup: body.bloodGroup ?? null,
        facilityId: body.facilityId ?? null,
        resultCount: result.results?.length ?? 0,
        created: (result.results ?? []).filter((r) => r.action === 'created')
          .length,
        updated: (result.results ?? []).filter((r) => r.action === 'updated')
          .length,
        resolved: (result.results ?? []).filter((r) => r.action === 'resolved')
          .length,
      },
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    })

    return jsonOk(c, {
      results: result.results,
    })
  },
)

/**
 * GET /alerts/:id/matches
 * On-demand potentially eligible donors for the alert blood group.
 * Does not send notifications — user review required (docs/08).
 * Query: limit?, offset?
 */
alertRoutes.get(
  '/:id/matches',
  requirePermission('alerts:read', 'donors:read'),
  async (c) => {
    const { id } = parseParams(c, alertIdParamSchema)
    const query = parseQuery(c, listAlertMatchesQuerySchema)
    const actor = c.get('user')
    const result = await listMatchesForAlert(getDb(), id, query)

    await recordActivity({
      actorUserId: actor?.id ?? null,
      action: AlertAuditActions.MATCHES_VIEWED,
      entityType: 'shortage_alert',
      entityId: result.alert?.id ?? id,
      metadata: {
        bloodGroupId: result.alert?.bloodGroupId ?? null,
        matchCount: result.total,
        limit: result.limit,
        offset: result.offset,
        notificationsSent: false,
      },
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    })

    return jsonOk(c, {
      alert: result.alert,
      matches: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      disclaimer: result.disclaimer,
    })
  },
)

/**
 * GET /alerts/:id
 */
alertRoutes.get('/:id', requirePermission('alerts:read'), async (c) => {
  const { id } = parseParams(c, alertIdParamSchema)
  const alert = await getAlertById(getDb(), id)
  return jsonOk(c, { alert })
})

/**
 * PATCH /alerts/:id/status
 * Body: { status } — forward-only lifecycle (docs/08).
 */
alertRoutes.patch(
  '/:id/status',
  requirePermission('alerts:update'),
  async (c) => {
    const { id } = parseParams(c, alertIdParamSchema)
    const body = await parseJsonBody(c, patchAlertStatusBodySchema)
    const actor = c.get('user')
    const result = await patchAlertStatus(getDb(), id, body)

    await recordActivity({
      actorUserId: actor?.id ?? null,
      action: AlertAuditActions.STATUS_CHANGE,
      entityType: 'shortage_alert',
      entityId: result.alert.id,
      metadata: {
        previousStatus: result.previousStatus,
        status: result.alert.status,
        severity: result.alert.severity,
        bloodGroupId: result.alert.bloodGroupId,
        facilityId: result.alert.facilityId,
        projectedGap: result.alert.projectedGap,
      },
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    })

    return jsonOk(c, { alert: result.alert })
  },
)
