/**
 * Inventory Zod schema unit tests (no DB / no network).
 */

import { describe, expect, test } from 'bun:test'

import {
  inventoryExpiringQuerySchema,
  inventoryIdParamSchema,
  inventoryLowStockQuerySchema,
  inventorySummaryQuerySchema,
  listInventoryQuerySchema,
  updateInventoryBodySchema,
} from './schemas'

describe('inventoryIdParamSchema', () => {
  test('coerces positive integer ids', () => {
    expect(inventoryIdParamSchema.parse({ id: '12' })).toEqual({ id: 12 })
  })

  test('rejects non-positive ids', () => {
    expect(inventoryIdParamSchema.safeParse({ id: '0' }).success).toBe(false)
  })
})

describe('listInventoryQuerySchema', () => {
  test('defaults pagination', () => {
    const parsed = listInventoryQuerySchema.parse({})
    expect(parsed.limit).toBe(50)
    expect(parsed.offset).toBe(0)
  })

  test('parses availableOnly flag', () => {
    expect(
      listInventoryQuerySchema.parse({ availableOnly: 'true' }).availableOnly,
    ).toBe(true)
    expect(
      listInventoryQuerySchema.parse({ availableOnly: '0' }).availableOnly,
    ).toBe(false)
  })

  test('accepts status and blood group filters', () => {
    const parsed = listInventoryQuerySchema.parse({
      status: 'AVAILABLE',
      bloodGroup: 'O+',
      facilityId: '3',
    })
    expect(parsed.status).toBe('AVAILABLE')
    expect(parsed.bloodGroup).toBe('O+')
    expect(parsed.facilityId).toBe(3)
  })
})

describe('inventorySummaryQuerySchema', () => {
  test('defaults threshold and expiring window', () => {
    const parsed = inventorySummaryQuerySchema.parse({})
    expect(parsed.lowStockThreshold).toBe(5)
    expect(parsed.expiringWithinDays).toBe(7)
  })
})

describe('inventoryLowStockQuerySchema', () => {
  test('defaults threshold to 5', () => {
    expect(inventoryLowStockQuerySchema.parse({}).threshold).toBe(5)
  })
})

describe('inventoryExpiringQuerySchema', () => {
  test('defaults withinDays to 7', () => {
    expect(inventoryExpiringQuerySchema.parse({}).withinDays).toBe(7)
  })
})

describe('updateInventoryBodySchema', () => {
  test('requires at least one field', () => {
    expect(updateInventoryBodySchema.safeParse({}).success).toBe(false)
  })

  test('accepts status and nullable facilityId', () => {
    const parsed = updateInventoryBodySchema.parse({
      status: 'RESERVED',
      facilityId: null,
    })
    expect(parsed.status).toBe('RESERVED')
    expect(parsed.facilityId).toBeNull()
  })
})
