/**
 * Report routes (docs/04 Reports/, TODO.md §9).
 * Mounted under /api/v1/reports — distinct from /dashboard/* if added in parallel.
 *
 * Permission: reports:read on all GET endpoints (docs/10).
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import {
  demandReportQuerySchema,
  donationsReportQuerySchema,
  inventoryReportQuerySchema,
  notificationsReportQuerySchema,
  predictionsReportQuerySchema,
} from './schemas'
import {
  getDemandReport,
  getDonationsReport,
  getInventoryReport,
  getNotificationsReport,
  getPredictionsReport,
} from './service'

export const reportRoutes = new Hono<AppHonoEnv>()

reportRoutes.use('*', requireAuth)

/**
 * GET /reports/inventory
 * Query: asOf?, bloodGroupId?, bloodGroup?, facilityId?
 */
reportRoutes.get(
  '/inventory',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, inventoryReportQuerySchema)
    const report = await getInventoryReport(getDb(), query)
    return jsonOk(c, report)
  },
)

/**
 * GET /reports/donations
 * Query: from?, to?, bloodGroupId?, bloodGroup?
 */
reportRoutes.get(
  '/donations',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, donationsReportQuerySchema)
    const report = await getDonationsReport(getDb(), query)
    return jsonOk(c, report)
  },
)

/**
 * GET /reports/demand
 * Query: from?, to?, bloodGroupId?, bloodGroup?
 */
reportRoutes.get('/demand', requirePermission('reports:read'), async (c) => {
  const query = parseQuery(c, demandReportQuerySchema)
  const report = await getDemandReport(getDb(), query)
  return jsonOk(c, report)
})

/**
 * GET /reports/predictions
 * Query: from?, to?, bloodGroupId?, bloodGroup? (filters forecast_start)
 */
reportRoutes.get(
  '/predictions',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, predictionsReportQuerySchema)
    const report = await getPredictionsReport(getDb(), query)
    return jsonOk(c, report)
  },
)

/**
 * GET /reports/notifications
 * Query: from?, to?, bloodGroupId?, bloodGroup?, channel?, status?
 */
reportRoutes.get(
  '/notifications',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, notificationsReportQuerySchema)
    const report = await getNotificationsReport(getDb(), query)
    return jsonOk(c, report)
  },
)
