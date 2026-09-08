/**
 * Dashboard routes (docs/04 Dashboard, TODO.md §9).
 * Mounted under /api/v1/dashboard.
 *
 * Permissions (docs/10):
 * - All GET endpoints → reports:read (Authorized Manager / Admin dashboards)
 *
 * Values are server-computed; clients must not invent KPI totals.
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import {
  dashboardAlertsQuerySchema,
  dashboardPredictionsQuerySchema,
  dashboardSummaryQuerySchema,
  dashboardTrendQuerySchema,
} from './schemas'
import {
  getDashboardAlerts,
  getDashboardPredictions,
  getDashboardSummary,
  getDemandTrend,
  getDonationTrend,
  getInventoryTrend,
} from './service'

export const dashboardRoutes = new Hono<AppHonoEnv>()

dashboardRoutes.use('*', requireAuth)

/**
 * GET /dashboard/summary
 * KPI cards: available units, low-stock groups, active alerts,
 * donations this period, notifications sent + blood-group distribution.
 */
dashboardRoutes.get(
  '/summary',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, dashboardSummaryQuerySchema)
    const summary = await getDashboardSummary(getDb(), query)
    return jsonOk(c, { summary })
  },
)

/**
 * GET /dashboard/inventory-trend
 * Units collected per day (collection_date) within the period.
 */
dashboardRoutes.get(
  '/inventory-trend',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, dashboardTrendQuerySchema)
    const trend = await getInventoryTrend(getDb(), query)
    return jsonOk(c, { trend })
  },
)

/**
 * GET /dashboard/donation-trend
 * Donated units per donation_date within the period.
 */
dashboardRoutes.get(
  '/donation-trend',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, dashboardTrendQuerySchema)
    const trend = await getDonationTrend(getDb(), query)
    return jsonOk(c, { trend })
  },
)

/**
 * GET /dashboard/demand-trend
 * Demand units requested per day from demand_records.
 */
dashboardRoutes.get(
  '/demand-trend',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, dashboardTrendQuerySchema)
    const trend = await getDemandTrend(getDb(), query)
    return jsonOk(c, { trend })
  },
)

/**
 * GET /dashboard/predictions
 * Latest prediction snapshot per blood group (includes daily series).
 */
dashboardRoutes.get(
  '/predictions',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, dashboardPredictionsQuerySchema)
    const result = await getDashboardPredictions(getDb(), query)
    return jsonOk(c, {
      facilityId: result.facilityId,
      predictions: result.predictions,
    })
  },
)

/**
 * GET /dashboard/alerts
 * Recent shortage alerts for the dashboard alert table (default: active only).
 */
dashboardRoutes.get(
  '/alerts',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, dashboardAlertsQuerySchema)
    const result = await getDashboardAlerts(getDb(), query)
    return jsonOk(c, {
      alerts: result.alerts,
      total: result.total,
      limit: result.limit,
      activeOnly: result.activeOnly,
    })
  },
)
