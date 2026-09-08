/**
 * Donation centre routes (docs/04 donation-centres module; TODO.md §4).
 * Mounted under /api/v1/donation-centres.
 *
 * Permissions (reuse donations RBAC — centres are donation prerequisites):
 * - list/get: donations:read
 * - create/patch: donations:create (includes soft active flag)
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import {
  createDonationCentreBodySchema,
  donationCentreIdParamSchema,
  listDonationCentresQuerySchema,
  patchDonationCentreBodySchema,
} from './schemas'
import {
  createDonationCentre,
  getDonationCentreById,
  listDonationCentres,
  patchDonationCentre,
} from './service'

export const donationCentreRoutes = new Hono<AppHonoEnv>()

donationCentreRoutes.use('*', requireAuth)

/**
 * GET /donation-centres
 * Query: region?, active? (true|false)
 */
donationCentreRoutes.get(
  '/',
  requirePermission('donations:read'),
  async (c) => {
    const query = parseQuery(c, listDonationCentresQuerySchema)
    const centres = await listDonationCentres(getDb(), query)
    return jsonOk(c, { centres })
  },
)

/**
 * POST /donation-centres
 * Body: { name, region, address?, active? }
 */
donationCentreRoutes.post(
  '/',
  requirePermission('donations:create'),
  async (c) => {
    const body = await parseJsonBody(c, createDonationCentreBodySchema)
    const centre = await createDonationCentre(getDb(), body)
    return jsonOk(c, { centre }, 201)
  },
)

/**
 * GET /donation-centres/:id
 */
donationCentreRoutes.get(
  '/:id',
  requirePermission('donations:read'),
  async (c) => {
    const { id } = parseParams(c, donationCentreIdParamSchema)
    const centre = await getDonationCentreById(getDb(), id)
    return jsonOk(c, { centre })
  },
)

/**
 * PATCH /donation-centres/:id
 * Soft-deactivate with { active: false }; no DELETE route.
 */
donationCentreRoutes.patch(
  '/:id',
  requirePermission('donations:create'),
  async (c) => {
    const { id } = parseParams(c, donationCentreIdParamSchema)
    const body = await parseJsonBody(c, patchDonationCentreBodySchema)
    const centre = await patchDonationCentre(getDb(), id, body)
    return jsonOk(c, { centre })
  },
)
