/**
 * Demand record routes (TODO.md §5, docs/06 demand_records, docs/14 AI shapes).
 * Mounted under /api/v1/demand-records.
 *
 * Permissions (docs/10 — demand feeds predictions):
 * - GET list / export → predictions:read
 * - POST sync → predictions:run
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import {
  DemandAuditActions,
  recordActivity,
} from '../../services/audit'
import {
  exportDemandQuerySchema,
  listDemandRecordsQuerySchema,
  syncDemandBodySchema,
} from './schemas'
import {
  exportDemandSeries,
  listDemandRecords,
  syncDemandFromBloodRequests,
} from './service'

export { DemandAuditActions }

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

export const demandRoutes = new Hono<AppHonoEnv>()

demandRoutes.use('*', requireAuth)

/**
 * GET /demand-records
 * Query: bloodGroupId? | bloodGroup?, facilityId?, from?, to?, source?, limit?, offset?
 */
demandRoutes.get('/', requirePermission('predictions:read'), async (c) => {
  const query = parseQuery(c, listDemandRecordsQuerySchema)
  const result = await listDemandRecords(getDb(), query)
  return jsonOk(c, {
    demandRecords: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  })
})

/**
 * GET /demand-records/export
 * Query: format=history|series, bloodGroup(required for history), facilityId?, from?, to?
 *
 * history → { blood_group, facility_id, history: [{ date, demand_units }] }
 * series  → { series: [{ blood_group, facility_id, date, demand_units }] }
 */
demandRoutes.get(
  '/export',
  requirePermission('predictions:read'),
  async (c) => {
    const query = parseQuery(c, exportDemandQuerySchema)
    const result = await exportDemandSeries(getDb(), query)
    return jsonOk(c, result)
  },
)

/**
 * POST /demand-records/sync
 * Body: { from?, to?, facilityId?, bloodGroupId? | bloodGroup? }
 * Idempotent upsert from APPROVED/PARTIAL/FULFILLED blood requests.
 */
demandRoutes.post('/sync', requirePermission('predictions:run'), async (c) => {
  const body = await parseJsonBody(c, syncDemandBodySchema)
  const actor = c.get('user')
  const sync = await syncDemandFromBloodRequests(getDb(), body)

  await recordActivity({
    actorUserId: actor?.id ?? null,
    action: DemandAuditActions.SYNC,
    entityType: 'demand_record',
    entityId: null,
    metadata: {
      from: body.from ?? null,
      to: body.to ?? null,
      facilityId: body.facilityId ?? null,
      bloodGroupId: body.bloodGroupId ?? null,
      bloodGroup: body.bloodGroup ?? null,
      inserted: sync.inserted,
      updated: sync.updated,
      deleted: sync.deleted,
      buckets: sync.buckets,
    },
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })

  return jsonOk(c, { sync })
})
