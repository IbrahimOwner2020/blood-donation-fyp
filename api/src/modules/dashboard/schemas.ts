/**
 * Zod schemas for dashboard query params (docs/04 Dashboard, TODO.md §9).
 */

import { z } from 'zod'

import { BLOOD_GROUP_SEEDS } from '../../db/seed/blood-groups-data'
import { DEFAULT_LOW_STOCK_THRESHOLD } from '../inventory/constants'
import { DEFAULT_DASHBOARD_PERIOD_DAYS } from './aggregate'

const BLOOD_GROUP_CODES = BLOOD_GROUP_SEEDS.map((g) => g.code) as [
  string,
  ...string[],
]

export const bloodGroupCodeSchema = z.enum(BLOOD_GROUP_CODES)

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

const optionalPositiveInt = z.coerce
  .number({ invalid_type_error: 'Value must be a number' })
  .int('Value must be an integer')
  .positive('Value must be positive')
  .optional()

const periodFields = {
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  /** Inclusive lookback days when `from` omitted (default 30). */
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(366)
    .optional()
    .default(DEFAULT_DASHBOARD_PERIOD_DAYS),
}

export const dashboardSummaryQuerySchema = z.object({
  ...periodFields,
  facilityId: optionalPositiveInt,
  asOf: dateOnlySchema.optional(),
  lowStockThreshold: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .optional()
    .default(DEFAULT_LOW_STOCK_THRESHOLD),
})

export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>

export const dashboardTrendQuerySchema = z.object({
  ...periodFields,
  facilityId: optionalPositiveInt,
  bloodGroupId: optionalPositiveInt,
  bloodGroup: bloodGroupCodeSchema.optional(),
  donationCentreId: optionalPositiveInt,
})

export type DashboardTrendQuery = z.infer<typeof dashboardTrendQuerySchema>

export const dashboardPredictionsQuerySchema = z.object({
  facilityId: optionalPositiveInt,
  bloodGroupId: optionalPositiveInt,
  bloodGroup: bloodGroupCodeSchema.optional(),
  /** Max latest-per-group rows returned (default: all blood groups). */
  limit: z.coerce.number().int().min(1).max(50).optional().default(16),
})

export type DashboardPredictionsQuery = z.infer<
  typeof dashboardPredictionsQuerySchema
>

export const dashboardAlertsQuerySchema = z.object({
  facilityId: optionalPositiveInt,
  bloodGroupId: optionalPositiveInt,
  bloodGroup: bloodGroupCodeSchema.optional(),
  activeOnly: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return true
      }
      if (typeof value === 'boolean') {
        return value
      }
      return value === 'true' || value === '1'
    }),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
})

export type DashboardAlertsQuery = z.infer<typeof dashboardAlertsQuerySchema>
