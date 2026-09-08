/**
 * Healthcare facilities routes (docs/04 facilities/, TODO.md §5).
 * Mounted under /api/v1/facilities.
 *
 * Permissions (docs/10 has no facilities:* codes — facilities gate blood requests):
 * - GET list/detail → requests:read
 * - POST create → requests:create
 * - PATCH update / soft-deactivate → requests:update
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import { recordActivity } from '../../services/audit'
import {
  createFacilityBodySchema,
  facilityIdParamSchema,
  listFacilitiesQuerySchema,
  patchFacilityBodySchema,
} from './schemas'
import {
  createFacility,
  getFacilityById,
  listFacilities,
  patchFacility,
} from './service'

export const FacilityAuditActions = {
  CREATE: 'facility.create',
  UPDATE: 'facility.update',
} as const

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

export const facilitiesRoutes = new Hono<AppHonoEnv>()

facilitiesRoutes.use('*', requireAuth)

/**
 * GET /facilities
 * Query: region?, district?, active?, q? (name contains)
 */
facilitiesRoutes.get(
  '/',
  requirePermission('requests:read'),
  async (c) => {
    const query = parseQuery(c, listFacilitiesQuerySchema)
    const facilities = await listFacilities(getDb(), query)
    return jsonOk(c, { facilities })
  },
)

/**
 * GET /facilities/:id
 */
facilitiesRoutes.get(
  '/:id',
  requirePermission('requests:read'),
  async (c) => {
    const { id } = parseParams(c, facilityIdParamSchema)
    const facility = await getFacilityById(getDb(), id)
    return jsonOk(c, { facility })
  },
)

/**
 * POST /facilities
 * Body: { name, region, district, active? }
 */
facilitiesRoutes.post(
  '/',
  requirePermission('requests:create'),
  async (c) => {
    const body = await parseJsonBody(c, createFacilityBodySchema)
    const facility = await createFacility(getDb(), body)
    const actor = c.get('user')

    await recordActivity({
      actorUserId: actor?.id ?? null,
      action: FacilityAuditActions.CREATE,
      entityType: 'healthcare_facility',
      entityId: facility.id,
      metadata: {
        name: facility.name,
        region: facility.region,
        district: facility.district,
        active: facility.active,
      },
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    })

    return jsonOk(c, { facility }, 201)
  },
)

/**
 * PATCH /facilities/:id
 * Body: partial { name?, region?, district?, active? }
 * Soft-deactivate via active: false (no hard delete).
 */
facilitiesRoutes.patch(
  '/:id',
  requirePermission('requests:update'),
  async (c) => {
    const { id } = parseParams(c, facilityIdParamSchema)
    const body = await parseJsonBody(c, patchFacilityBodySchema)
    const { facility, previous, patch } = await patchFacility(getDb(), id, body)
    const actor = c.get('user')

    await recordActivity({
      actorUserId: actor?.id ?? null,
      action: FacilityAuditActions.UPDATE,
      entityType: 'healthcare_facility',
      entityId: facility.id,
      metadata: {
        ...patch,
        previousActive: previous.active,
      },
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    })

    return jsonOk(c, { facility })
  },
)
