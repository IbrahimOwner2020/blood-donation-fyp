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
import { requireHospitalFacilityId } from '../auth/access-scope'
import {
  bloodRequestsReportQuerySchema,
  donorEligibilityReportQuerySchema,
  donationsReportQuerySchema,
  inventoryReportQuerySchema,
  notificationsReportQuerySchema,
} from './schemas'
import {
  getBloodRequestsReport,
  getDonorEligibilityReport,
  getDonationsReport,
  getInventoryReport,
  getNotificationsReport,
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
    const facilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
    const report = await getInventoryReport(
      getDb(),
      typeof facilityId === 'number' ? { ...query, facilityId } : query,
    )
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
reportRoutes.get('/blood-requests', requirePermission('reports:read'), async (c) => {
  const query = parseQuery(c, bloodRequestsReportQuerySchema)
  const facilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
  const report = await getBloodRequestsReport(
    getDb(),
    typeof facilityId === 'number' ? { ...query, facilityId } : query,
  )
  return jsonOk(c, report)
})

reportRoutes.get('/donor-eligibility', requirePermission('reports:read'), async (c) => {
  const query = parseQuery(c, donorEligibilityReportQuerySchema)
  const report = await getDonorEligibilityReport(getDb(), query)
  return jsonOk(c, report)
})


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
