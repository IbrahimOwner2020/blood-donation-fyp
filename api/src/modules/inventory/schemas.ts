/**
 * Zod schemas for inventory list/filter, summary, and status PATCH
 * (docs/04 inventory/, docs/06 blood_inventory, TODO.md §4).
 */

import { z } from 'zod'

import { inventoryStatuses } from '../../db/schema/enums'
import { BLOOD_GROUP_SEEDS } from '../../db/seed/blood-groups-data'
import {
  DEFAULT_EXPIRING_WITHIN_DAYS,
  DEFAULT_LOW_STOCK_THRESHOLD,
} from './constants'

const BLOOD_GROUP_CODES = BLOOD_GROUP_SEEDS.map((g) => g.code) as [
  string,
  ...string[],
]

export const bloodGroupCodeSchema = z.enum(BLOOD_GROUP_CODES)

export const inventoryStatusSchema = z.enum(inventoryStatuses)

const dateOnlySchema = z
  .string({
    invalid_type_error: 'Date must be a string',
  })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number)
    if (
      typeof y !== 'number' ||
      typeof m !== 'number' ||
      typeof d !== 'number' ||
      !Number.isFinite(y) ||
      !Number.isFinite(m) ||
      !Number.isFinite(d)
    ) {
      return false
    }
    const dt = new Date(Date.UTC(y, m - 1, d))
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    )
  }, 'Date must be a valid calendar date')

export const inventoryIdParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'Inventory id must be a number' })
    .int('Inventory id must be an integer')
    .positive('Inventory id must be positive'),
})

export type InventoryIdParam = z.infer<typeof inventoryIdParamSchema>

export const listInventoryQuerySchema = z.object({
  bloodGroupId: z.coerce
    .number({ invalid_type_error: 'bloodGroupId must be a number' })
    .int('bloodGroupId must be an integer')
    .positive('bloodGroupId must be positive')
    .optional(),
  bloodGroup: bloodGroupCodeSchema.optional(),
  status: inventoryStatusSchema.optional(),
  facilityId: z.coerce
    .number({ invalid_type_error: 'facilityId must be a number' })
    .int('facilityId must be an integer')
    .positive('facilityId must be positive')
    .optional(),
  donationId: z.coerce
    .number({ invalid_type_error: 'donationId must be a number' })
    .int('donationId must be an integer')
    .positive('donationId must be positive')
    .optional(),
  /** Include units with expiry_date on/after this date. */
  expiryFrom: dateOnlySchema.optional(),
  /** Include units with expiry_date on/before this date. */
  expiryTo: dateOnlySchema.optional(),
  /**
   * When true, only return units that count as available supply
   * (status AVAILABLE and not past calendar expiry as of `asOf` / today).
   */
  availableOnly: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  /** Reference date for availableOnly / expiry checks (default: UTC today). */
  asOf: dateOnlySchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>

export const inventorySummaryQuerySchema = z.object({
  asOf: dateOnlySchema.optional(),
  facilityId: z.coerce
    .number({ invalid_type_error: 'facilityId must be a number' })
    .int()
    .positive()
    .optional(),
  expiringWithinDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(90)
    .optional()
    .default(DEFAULT_EXPIRING_WITHIN_DAYS),
  lowStockThreshold: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .optional()
    .default(DEFAULT_LOW_STOCK_THRESHOLD),
})

export type InventorySummaryQuery = z.infer<typeof inventorySummaryQuerySchema>

export const inventoryLowStockQuerySchema = z.object({
  asOf: dateOnlySchema.optional(),
  facilityId: z.coerce
    .number({ invalid_type_error: 'facilityId must be a number' })
    .int()
    .positive()
    .optional(),
  threshold: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .optional()
    .default(DEFAULT_LOW_STOCK_THRESHOLD),
  expiringWithinDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(90)
    .optional()
    .default(DEFAULT_EXPIRING_WITHIN_DAYS),
})

export type InventoryLowStockQuery = z.infer<typeof inventoryLowStockQuerySchema>

export const inventoryExpiringQuerySchema = z.object({
  asOf: dateOnlySchema.optional(),
  facilityId: z.coerce
    .number({ invalid_type_error: 'facilityId must be a number' })
    .int()
    .positive()
    .optional(),
  bloodGroupId: z.coerce
    .number({ invalid_type_error: 'bloodGroupId must be a number' })
    .int()
    .positive()
    .optional(),
  withinDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(90)
    .optional()
    .default(DEFAULT_EXPIRING_WITHIN_DAYS),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export type InventoryExpiringQuery = z.infer<typeof inventoryExpiringQuerySchema>

/**
 * PATCH — status and/or facility assignment (docs/04 PATCH /inventory/:id).
 * Requires inventory:update.
 */
export const updateInventoryBodySchema = z
  .object({
    status: inventoryStatusSchema.optional(),
    facilityId: z
      .number({ invalid_type_error: 'Facility id must be a number' })
      .int('Facility id must be an integer')
      .positive('Facility id must be positive')
      .nullable()
      .optional(),
  })
  .refine(
    (body) => body.status !== undefined || body.facilityId !== undefined,
    { message: 'At least one field is required' },
  )

export type UpdateInventoryBody = z.infer<typeof updateInventoryBodySchema>
