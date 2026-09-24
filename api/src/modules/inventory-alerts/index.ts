import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { getDb } from '../../db'
import { bloodGroups, healthcareFacilities, inventoryAlerts } from '../../db/schema'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import { requireHospitalFacilityId } from '../auth/access-scope'
import { getInventoryLowStock, listExpiringInventory } from '../inventory/service'

const listSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']).optional(),
  kind: z.enum(['LOW_STOCK', 'EXPIRING_UNIT']).optional(),
  facilityId: z.coerce.number().int().positive().optional(),
})

const refreshSchema = z.object({
  facilityId: z.number().int().positive().optional(),
  threshold: z.number().int().min(0).max(10000).default(5),
  expiringWithinDays: z.number().int().min(1).max(90).default(7),
})

export const inventoryAlertRoutes = new Hono<AppHonoEnv>()
inventoryAlertRoutes.use('*', requireAuth)

inventoryAlertRoutes.get('/', requirePermission('alerts:read'), async (c) => {
  const query = parseQuery(c, listSchema)
  const scopedFacilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
  const facilityId = scopedFacilityId ?? query.facilityId
  const filters = []
  if (query.status) filters.push(eq(inventoryAlerts.status, query.status))
  if (query.kind) filters.push(eq(inventoryAlerts.kind, query.kind))
  if (facilityId) filters.push(eq(inventoryAlerts.facilityId, facilityId))
  const rows = await getDb().select({ alert: inventoryAlerts, bloodGroup: bloodGroups, facility: healthcareFacilities })
    .from(inventoryAlerts)
    .innerJoin(bloodGroups, eq(inventoryAlerts.bloodGroupId, bloodGroups.id))
    .leftJoin(healthcareFacilities, eq(inventoryAlerts.facilityId, healthcareFacilities.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(inventoryAlerts.createdAt))
  return jsonOk(c, { alerts: rows })
})

inventoryAlertRoutes.post('/refresh', requirePermission('alerts:update'), async (c) => {
  const body = await parseJsonBody(c, refreshSchema)
  const scopedFacilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
  const facilityId = scopedFacilityId ?? body.facilityId
  const db = getDb()
  const lowStock = await getInventoryLowStock(db, { facilityId, threshold: body.threshold, expiringWithinDays: body.expiringWithinDays })
  const expiring = await listExpiringInventory(db, { facilityId, withinDays: body.expiringWithinDays, limit: 100, offset: 0 })
  const values = [
    ...lowStock.groups.map((group) => ({
      kind: 'LOW_STOCK' as const,
      bloodGroupId: group.bloodGroupId,
      facilityId: facilityId ?? null,
      inventoryUnitId: null,
      currentUnits: group.availableUnits,
      thresholdUnits: body.threshold,
      expiryDate: null,
      conditionKey: `LOW_STOCK:${facilityId ?? 'ALL'}:${group.bloodGroupId}:${body.threshold}`,
      severity: group.availableUnits === 0 ? 'CRITICAL' as const : group.availableUnits <= Math.ceil(body.threshold / 2) ? 'HIGH' as const : 'MEDIUM' as const,
      status: 'OPEN' as const,
    })),
    ...expiring.items.map((unit) => ({
      kind: 'EXPIRING_UNIT' as const,
      bloodGroupId: unit.bloodGroupId,
      facilityId: unit.facilityId,
      inventoryUnitId: unit.id,
      currentUnits: 1,
      thresholdUnits: null,
      expiryDate: unit.expiryDate,
      conditionKey: `EXPIRING_UNIT:${unit.id}:${unit.expiryDate}`,
      severity: unit.daysUntilExpiry <= 2 ? 'HIGH' as const : 'MEDIUM' as const,
      status: 'OPEN' as const,
    })),
  ]
  if (values.length) {
    for (const value of values) {
      await db.insert(inventoryAlerts).values(value).onDuplicateKeyUpdate({ set: { currentUnits: value.currentUnits, severity: value.severity, status: 'OPEN', resolvedAt: null } })
    }
  }
  return jsonOk(c, { refreshed: values.length, lowStock: lowStock.groups.length, expiringUnits: expiring.items.length })
})
