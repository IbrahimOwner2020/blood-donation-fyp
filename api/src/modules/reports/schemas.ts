/**
 * Zod schemas for report query filters (docs/04 Reports, TODO.md §9).
 * Common filters: date range (`from`/`to`) and blood group where applicable.
 * Inventory uses point-in-time `asOf` (optional `from`/`to` ignored).
 */

import { z } from 'zod'

import { BLOOD_GROUP_SEEDS } from '../../db/seed/blood-groups-data'
import {
  notificationChannels,
  notificationStatuses,
} from '../../db/schema/enums'

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

function refineDateRange<T extends { from?: string; to?: string }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`from` must be on or before `to`',
      path: ['from'],
    })
  }
}

const bloodGroupFilters = {
  bloodGroupId: z.coerce
    .number({ invalid_type_error: 'bloodGroupId must be a number' })
    .int('bloodGroupId must be an integer')
    .positive('bloodGroupId must be positive')
    .optional(),
  bloodGroup: bloodGroupCodeSchema.optional(),
}

/** Shared date + blood-group filters for donations/demand/predictions. */
export const reportDateBloodGroupQuerySchema = z
  .object({
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    ...bloodGroupFilters,
  })
  .superRefine(refineDateRange)

export type ReportDateBloodGroupQuery = z.infer<
  typeof reportDateBloodGroupQuerySchema
>

/**
 * Inventory report — point-in-time snapshot.
 * `asOf` defaults to UTC today; optional blood-group filter.
 */
export const inventoryReportQuerySchema = z.object({
  asOf: dateOnlySchema.optional(),
  ...bloodGroupFilters,
  facilityId: z.coerce
    .number({ invalid_type_error: 'facilityId must be a number' })
    .int('facilityId must be an integer')
    .positive('facilityId must be positive')
    .optional(),
})

export type InventoryReportQuery = z.infer<typeof inventoryReportQuerySchema>

export const donationsReportQuerySchema = reportDateBloodGroupQuerySchema
export type DonationsReportQuery = ReportDateBloodGroupQuery

export const demandReportQuerySchema = reportDateBloodGroupQuerySchema
export type DemandReportQuery = ReportDateBloodGroupQuery

export const predictionsReportQuerySchema = reportDateBloodGroupQuerySchema
export type PredictionsReportQuery = ReportDateBloodGroupQuery

/** Notifications — date range on created_at; blood group via donor join. */
export const notificationsReportQuerySchema = z
  .object({
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    ...bloodGroupFilters,
    channel: z.enum(notificationChannels).optional(),
    status: z.enum(notificationStatuses).optional(),
  })
  .superRefine(refineDateRange)

export type NotificationsReportQuery = z.infer<
  typeof notificationsReportQuerySchema
>
