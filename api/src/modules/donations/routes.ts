/**
 * Donation routes (docs/04 donations/, TODO.md §4).
 * Mounted under /api/v1/donations.
 *
 * Permissions (docs/10 — no donations:update code):
 * - GET list/detail → donations:read
 * - POST create → donations:create
 * - PATCH notes/centre → donations:create
 *
 * Recording a donation creates linked AVAILABLE inventory unit rows
 * in the same transaction (docs/06 unit-linked model).
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { AppError } from '../../lib/errors'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import { DonationAuditActions, recordActivity } from '../../services/audit'
import { requireHospitalFacilityId } from '../auth/access-scope'
import {
  createDonationBodySchema,
  donationIdParamSchema,
  listDonationsQuerySchema,
  updateDonationBodySchema,
} from './schemas'
import {
  createDonation,
  getDonationById,
  listDonations,
  updateDonation,
} from './service'

export { DonationAuditActions }
export type { DonationAuditAction } from '../../services/audit'

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

export const donationRoutes = new Hono<AppHonoEnv>()

donationRoutes.use('*', requireAuth)

/**
 * GET /donations
 * Query: donorId?, donationCentreId?, bloodGroupId?, bloodGroup?, from?, to?,
 *        limit?, offset?
 */
donationRoutes.get('/', requirePermission('donations:read'), async (c) => {
  const query = parseQuery(c, listDonationsQuerySchema)
  const facilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
  const result = await listDonations(
    getDb(),
    typeof facilityId === 'number' ? { ...query, facilityId } : query,
  )

  return jsonOk(c, {
    donations: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  })
})

/**
 * POST /donations
 * Body: donorId, donationCentreId, bloodGroupId, donationDate, units?, notes?,
 *       facilityId?
 * Creates `units` inventory rows (AVAILABLE) linked to the donation.
 */
donationRoutes.post('/', requirePermission('donations:create'), async (c) => {
  const body = await parseJsonBody(c, createDonationBodySchema)
  const actor = c.get('user')
  if (!actor?.id) {
    throw AppError.unauthorized('Authenticated user required')
  }
  const actorId = actor.id
  const facilityId = requireHospitalFacilityId(actor, c.get('roles'))

  const donation = await createDonation(
    getDb(),
    typeof facilityId === 'number' ? { ...body, facilityId } : body,
    actorId,
  )

  await recordActivity({
    actorUserId: actorId,
    action: DonationAuditActions.CREATE,
    entityType: 'donation',
    entityId: donation.id,
    metadata: {
      donorId: donation.donorId,
      donationCentreId: donation.donationCentreId,
      bloodGroupId: donation.bloodGroupId,
      bloodGroupCode: donation.bloodGroup?.code ?? null,
      donationDate: donation.donationDate,
      units: donation.units,
      inventoryUnitCount: donation.inventoryUnitCount ?? donation.units,
      /** Comma-separated ids — ActivityMetadata does not allow arrays. */
      inventoryUnitIds: (donation.inventoryUnitIds ?? []).join(','),
    },
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })

  return jsonOk(c, { donation }, 201)
})

/**
 * GET /donations/:id
 */
donationRoutes.get('/:id', requirePermission('donations:read'), async (c) => {
  const { id } = parseParams(c, donationIdParamSchema)
  const facilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
  const donation = await getDonationById(
    getDb(),
    id,
    typeof facilityId === 'number' ? { facilityId } : {},
  )
  return jsonOk(c, { donation })
})

/**
 * PATCH /donations/:id
 * Body: notes? and/or donationCentreId?
 */
donationRoutes.patch(
  '/:id',
  requirePermission('donations:create'),
  async (c) => {
    const { id } = parseParams(c, donationIdParamSchema)
    const body = await parseJsonBody(c, updateDonationBodySchema)
    const actor = c.get('user')
    const facilityId = requireHospitalFacilityId(actor, c.get('roles'))
    if (typeof facilityId === 'number') {
      await getDonationById(getDb(), id, { facilityId })
    }
    const donation = await updateDonation(getDb(), id, body)

    await recordActivity({
      actorUserId: actor?.id ?? null,
      action: DonationAuditActions.UPDATE,
      entityType: 'donation',
      entityId: donation.id,
      metadata: {
        donorId: donation.donorId,
        donationCentreId: donation.donationCentreId,
        notes: donation.notes,
        fieldsUpdated: Object.keys(body ?? {}).join(','),
      },
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    })

    return jsonOk(c, { donation })
  },
)
