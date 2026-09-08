/**
 * Activity / audit log list routes (docs/06, docs/10 activity:read).
 * Mounted under /api/v1/activity-logs.
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import { listActivityLogsQuerySchema } from './schemas'
import { listActivityLogs } from './service'

export const activityLogRoutes = new Hono<AppHonoEnv>()

activityLogRoutes.use('*', requireAuth)

/**
 * GET /activity-logs
 * Query: userId?, action?, entityType?, entityId?, q?, createdFrom?, createdTo?,
 *        limit?, offset?
 * Requires activity:read.
 */
activityLogRoutes.get('/', requirePermission('activity:read'), async (c) => {
  const query = parseQuery(c, listActivityLogsQuerySchema)
  const result = await listActivityLogs(getDb(), query)

  return jsonOk(c, {
    activityLogs: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  })
})
