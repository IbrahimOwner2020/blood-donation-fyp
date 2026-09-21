/**
 * Healthcare facilities routes (docs/04 facilities/, TODO.md §5).
 * Mounted under /api/v1/facilities.
 *
 * Permissions:
 * - GET list/detail -> facilities:read
 * - POST create -> facilities:create
 * - PATCH update / soft-deactivate -> facilities:update
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { AppError } from '../../lib/errors'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import { recordActivity } from '../../services/audit'
import {
  isFacilityManager,
  isHospitalStaff,
  requireAssignedFacilityId,
  requireHospitalFacilityId,
} from '../auth/access-scope'
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

function shouldScopeFacilityView(
  permissions: readonly string[] | undefined,
): boolean {
  const granted = permissions ?? []
  return (
    !granted.includes('facilities:create') &&
    !granted.includes('users:manage')
  )
}

/**
 * GET /facilities
 * Query: region?, district?, active?, q? (name contains)
 */
facilitiesRoutes.get(
  '/',
  requirePermission('facilities:read'),
  async (c) => {
    const roles = c.get('roles')
    const user = c.get('user')
    const facilityId =
      isFacilityManager(roles) && shouldScopeFacilityView(c.get('permissions'))
        ? requireAssignedFacilityId(user)
        : requireHospitalFacilityId(user, roles)
    if (typeof facilityId === 'number') {
      const facility = await getFacilityById(getDb(), facilityId)
      return jsonOk(c, { facilities: [facility] })
    }
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
  requirePermission('facilities:read'),
  async (c) => {
    const { id } = parseParams(c, facilityIdParamSchema)
    const roles = c.get('roles')
    const user = c.get('user')
    const facilityId =
      isFacilityManager(roles) && shouldScopeFacilityView(c.get('permissions'))
        ? requireAssignedFacilityId(user)
        : requireHospitalFacilityId(user, roles)
    if (typeof facilityId === 'number' && id !== facilityId) {
      throw AppError.notFound('Facility not found')
    }
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
  requirePermission('facilities:create'),
  async (c) => {
    if (isHospitalStaff(c.get('roles'))) {
      throw AppError.forbidden('Hospital staff cannot create facilities')
    }
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
  requirePermission('facilities:update'),
  async (c) => {
    if (isHospitalStaff(c.get('roles'))) {
      throw AppError.forbidden('Hospital staff cannot update facilities')
    }
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
