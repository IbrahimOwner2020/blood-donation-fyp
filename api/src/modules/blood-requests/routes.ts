/**
 * Blood request routes (docs/04 blood-requests/, TODO.md §5).
 * Mounted under /api/v1/blood-requests.
 *
 * Permissions (docs/10):
 * - GET list/detail → requests:read
 * - POST create → requests:create
 * - PATCH status/fulfilment → requests:update
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
  BloodRequestAuditActions,
  recordActivity,
} from '../../services/audit'
import { requireHospitalFacilityId } from '../auth/access-scope'
import {
  bloodRequestIdParamSchema,
  createBloodRequestBodySchema,
  listBloodRequestsQuerySchema,
  patchBloodRequestBodySchema,
} from './schemas'
import {
  createBloodRequest,
  getBloodRequestById,
  listBloodRequests,
  patchBloodRequestStatus,
} from './service'

export { BloodRequestAuditActions }

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

export const bloodRequestRoutes = new Hono<AppHonoEnv>()

bloodRequestRoutes.use('*', requireAuth)

/**
 * GET /blood-requests
 * Query: facilityId?, bloodGroupId?, status?, priority?, limit?, offset?
 */
bloodRequestRoutes.get(
  '/',
  requirePermission('requests:read'),
  async (c) => {
    const query = parseQuery(c, listBloodRequestsQuerySchema)
    const facilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
    const result = await listBloodRequests(
      getDb(),
      typeof facilityId === 'number' ? { ...query, facilityId } : query,
    )
    return jsonOk(c, {
      bloodRequests: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    })
  },
)

/**
 * POST /blood-requests
 * Body: facilityId, bloodGroupId, unitsRequested, priority?, requestedAt?, requiredAt?
 * Creates with status PENDING, fulfilledUnits 0.
 */
bloodRequestRoutes.post(
  '/',
  requirePermission('requests:create'),
  async (c) => {
    const body = await parseJsonBody(c, createBloodRequestBodySchema)
    const actor = c.get('user')
    if (!actor?.id) {
      // requireAuth should always set user; defensive guard for created_by FK.
      throw AppError.unauthorized('Authenticated user required')
    }
    const facilityId = requireHospitalFacilityId(actor, c.get('roles'))
    const bloodRequest = await createBloodRequest(
      getDb(),
      typeof facilityId === 'number' ? { ...body, facilityId } : body,
      actor.id,
    )

    await recordActivity({
      actorUserId: actor.id,
      action: BloodRequestAuditActions.CREATE,
      entityType: 'blood_request',
      entityId: bloodRequest.id,
      metadata: {
        facilityId: bloodRequest.facilityId,
        bloodGroupId: bloodRequest.bloodGroupId,
        unitsRequested: bloodRequest.unitsRequested,
        priority: bloodRequest.priority,
        status: bloodRequest.status,
      },
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    })

    return jsonOk(c, { bloodRequest }, 201)
  },
)

/**
 * GET /blood-requests/:id
 */
bloodRequestRoutes.get(
  '/:id',
  requirePermission('requests:read'),
  async (c) => {
    const { id } = parseParams(c, bloodRequestIdParamSchema)
    const bloodRequest = await getBloodRequestById(getDb(), id)
    const facilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
    if (typeof facilityId === 'number' && bloodRequest.facilityId !== facilityId) {
      throw AppError.notFound('Blood request not found')
    }
    return jsonOk(c, { bloodRequest })
  },
)

/**
 * PATCH /blood-requests/:id
 * Body: { status, fulfilledUnits? } — enforces status machine + unit rules.
 * Audits significant status changes (docs/10).
 */
bloodRequestRoutes.patch(
  '/:id',
  requirePermission('requests:update'),
  async (c) => {
    const { id } = parseParams(c, bloodRequestIdParamSchema)
    const body = await parseJsonBody(c, patchBloodRequestBodySchema)
    const actor = c.get('user')
    const facilityId = requireHospitalFacilityId(actor, c.get('roles'))
    if (typeof facilityId === 'number') {
      const existing = await getBloodRequestById(getDb(), id)
      if (existing.facilityId !== facilityId) {
        throw AppError.notFound('Blood request not found')
      }
    }
    const result = await patchBloodRequestStatus(getDb(), id, body)

    const statusChanged = result.previousStatus !== result.nextStatus
    const fulfilmentChanged =
      result.previousFulfilledUnits !== result.nextFulfilledUnits

    if (statusChanged || fulfilmentChanged) {
      await recordActivity({
        actorUserId: actor?.id ?? null,
        action: BloodRequestAuditActions.STATUS_CHANGE,
        entityType: 'blood_request',
        entityId: result.bloodRequest.id,
        metadata: {
          previousStatus: result.previousStatus,
          nextStatus: result.nextStatus,
          previousFulfilledUnits: result.previousFulfilledUnits,
          nextFulfilledUnits: result.nextFulfilledUnits,
          unitsRequested: result.bloodRequest.unitsRequested,
        },
        requestId: c.get('requestId') ?? null,
        ipAddress: clientIp(c),
      })
    }

    return jsonOk(c, { bloodRequest: result.bloodRequest })
  },
)
