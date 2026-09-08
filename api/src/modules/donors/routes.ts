/**
 * Donor routes (docs/04 donors/, TODO.md §3).
 * Mounted under /api/v1/donors.
 *
 * Permissions:
 * - GET list/detail → donors:read
 * - POST create → donors:create
 * - PATCH update / DELETE soft-deactivate → donors:update
 *
 * Does not implement /donors/matches — use GET /alerts/:id/matches (donor-matching).
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import { DonorAuditActions, recordActivity } from '../../services/audit'
import {
  createDonorBodySchema,
  donorIdParamSchema,
  listDonorsQuerySchema,
  updateDonorBodySchema,
} from './schemas'
import {
  createDonor,
  deactivateDonor,
  getDonorById,
  listDonors,
  updateDonor,
} from './service'

export { DonorAuditActions }
export type { DonorAuditAction } from '../../services/audit'

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

export const donorRoutes = new Hono<AppHonoEnv>()

donorRoutes.use('*', requireAuth)

/**
 * GET /donors
 * Query: bloodGroupId?, bloodGroup?, donationCentreId?, active?,
 *        eligibilityStatus?, q?, limit?, offset?
 */
donorRoutes.get('/', requirePermission('donors:read'), async (c) => {
  const query = parseQuery(c, listDonorsQuerySchema)
  const result = await listDonors(getDb(), query)

  return jsonOk(c, {
    donors: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  })
})

/**
 * POST /donors
 * Body: donorNumber, firstName, lastName, bloodGroupId, phone?, email?,
 *       eligibilityStatus?, active?
 */
donorRoutes.post('/', requirePermission('donors:create'), async (c) => {
  const body = await parseJsonBody(c, createDonorBodySchema)
  const actor = c.get('user')
  const donor = await createDonor(getDb(), body)

  await recordActivity({
    actorUserId: actor?.id ?? null,
    action: DonorAuditActions.CREATE,
    entityType: 'donor',
    entityId: donor.id,
    metadata: {
      donorNumber: donor.donorNumber,
      bloodGroupId: donor.bloodGroupId,
      bloodGroupCode: donor.bloodGroup?.code ?? null,
      eligibilityStatus: donor.eligibilityStatus,
      active: donor.active,
    },
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })

  return jsonOk(c, { donor }, 201)
})

/**
 * GET /donors/:id
 */
donorRoutes.get('/:id', requirePermission('donors:read'), async (c) => {
  const { id } = parseParams(c, donorIdParamSchema)
  const donor = await getDonorById(getDb(), id)
  return jsonOk(c, { donor })
})

/**
 * PATCH /donors/:id
 * Soft-deactivate also possible via { active: false }.
 */
donorRoutes.patch('/:id', requirePermission('donors:update'), async (c) => {
  const { id } = parseParams(c, donorIdParamSchema)
  const body = await parseJsonBody(c, updateDonorBodySchema)
  const actor = c.get('user')
  const donor = await updateDonor(getDb(), id, body)

  await recordActivity({
    actorUserId: actor?.id ?? null,
    action: DonorAuditActions.UPDATE,
    entityType: 'donor',
    entityId: donor.id,
    metadata: {
      donorNumber: donor.donorNumber,
      bloodGroupId: donor.bloodGroupId,
      eligibilityStatus: donor.eligibilityStatus,
      active: donor.active,
      fieldsUpdated: Object.keys(body ?? {}).join(','),
    },
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })

  return jsonOk(c, { donor })
})

/**
 * DELETE /donors/:id
 * Soft-deactivate (active=false). History is retained.
 */
donorRoutes.delete('/:id', requirePermission('donors:update'), async (c) => {
  const { id } = parseParams(c, donorIdParamSchema)
  const actor = c.get('user')
  const donor = await deactivateDonor(getDb(), id)

  await recordActivity({
    actorUserId: actor?.id ?? null,
    action: DonorAuditActions.DEACTIVATE,
    entityType: 'donor',
    entityId: donor.id,
    metadata: {
      donorNumber: donor.donorNumber,
      active: donor.active,
    },
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })

  return jsonOk(c, { donor })
})
