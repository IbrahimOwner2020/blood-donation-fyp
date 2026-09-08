/**
 * Zod schemas for demand-record routes (TODO.md §5, docs/06 demand_records,
 * docs/14 AI history/series shape).
 */

import { z } from 'zod'

import { BLOOD_GROUP_SEEDS } from '../../db/seed/blood-groups-data'
import { demandSources } from '../../db/schema/enums'

const BLOOD_GROUP_CODES = BLOOD_GROUP_SEEDS.map((g) => g.code) as [
  string,
  ...string[],
]

export const bloodGroupCodeSchema = z.enum(BLOOD_GROUP_CODES)
export const demandSourceSchema = z.enum(demandSources)

/**
 * Calendar date `YYYY-MM-DD` for query filters (DATE column).
 */
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

const optionalPositiveId = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be an integer`)
    .positive(`${label} must be positive`)
    .optional()

const paginationSchema = {
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
}

/** Shared list / export filters. */
const demandFilterFields = {
  bloodGroupId: optionalPositiveId('bloodGroupId'),
  bloodGroup: bloodGroupCodeSchema.optional(),
  facilityId: optionalPositiveId('facilityId'),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  source: demandSourceSchema.optional(),
}

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

function refineBloodGroupExclusive<
  T extends { bloodGroupId?: number; bloodGroup?: string },
>(value: T, ctx: z.RefinementCtx): void {
  if (value.bloodGroupId !== undefined && value.bloodGroup !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide bloodGroupId or bloodGroup, not both',
      path: ['bloodGroup'],
    })
  }
}

export const listDemandRecordsQuerySchema = z
  .object({
    ...demandFilterFields,
    ...paginationSchema,
  })
  .superRefine((value, ctx) => {
    refineDateRange(value, ctx)
    refineBloodGroupExclusive(value, ctx)
  })

export type ListDemandRecordsQuery = z.infer<typeof listDemandRecordsQuerySchema>

export const exportDemandFormatSchema = z.enum(['history', 'series'])

/**
 * Export query — AI contract shapes (docs/14).
 * `history` requires a blood group (ForecastRequest.history).
 * `series` returns TrainingSeriesPoint[] (optionally multi-group).
 */
export const exportDemandQuerySchema = z
  .object({
    ...demandFilterFields,
    format: exportDemandFormatSchema.optional().default('history'),
  })
  .superRefine((value, ctx) => {
    refineDateRange(value, ctx)
    refineBloodGroupExclusive(value, ctx)
    if (value.format === 'history') {
      if (value.bloodGroupId === undefined && value.bloodGroup === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'bloodGroup or bloodGroupId is required for format=history',
          path: ['bloodGroup'],
        })
      }
    }
  })

export type ExportDemandQuery = z.infer<typeof exportDemandQuerySchema>

/**
 * Sync body — rebuild BLOOD_REQUEST-sourced demand_records from operational
 * approved/partial/fulfilled requests (idempotent).
 */
export const syncDemandBodySchema = z
  .object({
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    facilityId: optionalPositiveId('facilityId'),
    bloodGroupId: optionalPositiveId('bloodGroupId'),
    bloodGroup: bloodGroupCodeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    refineDateRange(value, ctx)
    refineBloodGroupExclusive(value, ctx)
  })

export type SyncDemandBody = z.infer<typeof syncDemandBodySchema>
