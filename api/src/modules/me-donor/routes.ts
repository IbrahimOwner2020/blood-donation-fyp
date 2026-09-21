/**
 * Self-service donor routes mounted at /api/v1/me/donor.
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { DonorAuditActions, recordActivity } from '../../services/audit'
import { listDonations } from '../donations'
import {
  getDonorByUserId,
  updateDonor,
} from '../donors'
import { updateOwnDonorBodySchema } from './schemas'

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

export const meDonorRoutes = new Hono<AppHonoEnv>()

meDonorRoutes.use('*', requireAuth)

meDonorRoutes.get('/', async (c) => {
  const user = c.get('user')
  const donor = await getDonorByUserId(getDb(), user?.id ?? 0)
  return jsonOk(c, { donor })
})

meDonorRoutes.patch('/', async (c) => {
  const user = c.get('user')
  const current = await getDonorByUserId(getDb(), user?.id ?? 0)
  const body = await parseJsonBody(c, updateOwnDonorBodySchema)
  const donor = await updateDonor(getDb(), current.id, body)

  await recordActivity({
    actorUserId: user?.id ?? null,
    action: DonorAuditActions.UPDATE,
    entityType: 'donor',
    entityId: donor.id,
    metadata: {
      selfService: true,
      fieldsUpdated: Object.keys(body ?? {}).join(','),
    },
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })

  return jsonOk(c, { donor })
})

meDonorRoutes.get('/donations', async (c) => {
  const user = c.get('user')
  const donor = await getDonorByUserId(getDb(), user?.id ?? 0)
  const result = await listDonations(getDb(), {
    donorId: donor.id,
    limit: 100,
    offset: 0,
  })
  return jsonOk(c, {
    donor,
    donations: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  })
})
