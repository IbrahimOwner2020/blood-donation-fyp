/**
 * Inventory routes (docs/04 inventory/, TODO.md §4).
 * Mounted under /api/v1/inventory.
 *
 * Permissions (docs/10):
 * - GET list/detail/summary/low-stock/expiring → inventory:read
 * - PATCH status/facility → inventory:update
 *
 * Unit creation remains owned by POST /donations (donations-api).
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { AppError } from '../../lib/errors'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import { InventoryAuditActions, recordActivity } from '../../services/audit'
import {
  inventoryExpiringQuerySchema,
  inventoryIdParamSchema,
  inventoryLowStockQuerySchema,
  inventorySummaryQuerySchema,
  listInventoryQuerySchema,
  updateInventoryBodySchema,
} from './schemas'
import {
  getInventoryById,
  getInventoryLowStock,
  getInventorySummary,
  listExpiringInventory,
  listInventory,
  updateInventoryUnit,
} from './service'

export { InventoryAuditActions }
export type { InventoryAuditAction } from '../../services/audit'

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

export const inventoryRoutes = new Hono<AppHonoEnv>()

inventoryRoutes.use('*', requireAuth)

/**
 * GET /inventory
 * Query: bloodGroupId?, bloodGroup?, status?, facilityId?, donationId?,
 *        expiryFrom?, expiryTo?, availableOnly?, asOf?, limit?, offset?
 */
inventoryRoutes.get('/', requirePermission('inventory:read'), async (c) => {
  const query = parseQuery(c, listInventoryQuerySchema)
  const result = await listInventory(getDb(), query)

  return jsonOk(c, {
    inventory: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    asOf: result.asOf,
  })
})

/**
 * GET /inventory/summary
 * Per blood-group counts; available excludes past-expiry units (docs/08).
 */
inventoryRoutes.get(
  '/summary',
  requirePermission('inventory:read'),
  async (c) => {
    const query = parseQuery(c, inventorySummaryQuerySchema)
    const summary = await getInventorySummary(getDb(), query)
    return jsonOk(c, { summary })
  },
)

/**
 * GET /inventory/low-stock
 * Groups whose effectively-available units are at or below threshold.
 */
inventoryRoutes.get(
  '/low-stock',
  requirePermission('inventory:read'),
  async (c) => {
    const query = parseQuery(c, inventoryLowStockQuerySchema)
    const result = await getInventoryLowStock(getDb(), query)
    return jsonOk(c, {
      asOf: result.asOf,
      threshold: result.threshold,
      groups: result.groups,
    })
  },
)

/**
 * GET /inventory/expiring
 * AVAILABLE units with expiry in [asOf, asOf+withinDays] (excludes past expiry).
 */
inventoryRoutes.get(
  '/expiring',
  requirePermission('inventory:read'),
  async (c) => {
    const query = parseQuery(c, inventoryExpiringQuerySchema)
    const result = await listExpiringInventory(getDb(), query)
    return jsonOk(c, {
      inventory: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      asOf: result.asOf,
      withinDays: result.withinDays,
      windowEnd: result.windowEnd,
    })
  },
)

/**
 * GET /inventory/:id
 */
inventoryRoutes.get('/:id', requirePermission('inventory:read'), async (c) => {
  const { id } = parseParams(c, inventoryIdParamSchema)
  const unit = await getInventoryById(getDb(), id)
  return jsonOk(c, { inventory: unit })
})

/**
 * PATCH /inventory/:id
 * Body: status? and/or facilityId?
 */
inventoryRoutes.patch(
  '/:id',
  requirePermission('inventory:update'),
  async (c) => {
    const { id } = parseParams(c, inventoryIdParamSchema)
    const body = await parseJsonBody(c, updateInventoryBodySchema)
    const actor = c.get('user')
    if (!actor?.id) {
      throw AppError.unauthorized('Authenticated user required')
    }

    const result = await updateInventoryUnit(getDb(), id, body)

    await recordActivity({
      actorUserId: actor.id,
      action: InventoryAuditActions.UPDATE,
      entityType: 'inventory',
      entityId: result.unit.id,
      metadata: {
        previousStatus: result.previousStatus,
        status: result.unit.status,
        previousFacilityId: result.previousFacilityId,
        facilityId: result.unit.facilityId,
        bloodGroupId: result.unit.bloodGroupId,
        bloodGroupCode: result.unit.bloodGroup?.code ?? null,
        fieldsUpdated: Object.keys(body ?? {}).join(','),
      },
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    })

    return jsonOk(c, { inventory: result.unit })
  },
)
