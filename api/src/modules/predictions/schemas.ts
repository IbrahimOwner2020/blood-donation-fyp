/**
 * Zod schemas for prediction routes (TODO.md §7, docs/04, docs/14).
 */

import { z } from 'zod'

import { BLOOD_GROUP_SEEDS } from '../../db/seed/blood-groups-data'
import type {
  CandidateModelName,
  HorizonDays,
  PreferredForecastModel,
} from '../../services/ai/types'

const BLOOD_GROUP_CODES = BLOOD_GROUP_SEEDS.map((g) => g.code) as [
  string,
  ...string[],
]

export const bloodGroupCodeSchema = z.enum(BLOOD_GROUP_CODES)

/** docs/14 horizon: 7 | 14 | 30 */
export const horizonDaysSchema = z.coerce
  .number({ invalid_type_error: 'horizonDays must be a number' })
  .refine((value): value is HorizonDays => value === 7 || value === 14 || value === 30, {
    message: 'horizonDays must be 7, 14, or 30',
  })

const CANDIDATE_MODELS = [
  'historical_average',
  'moving_average',
  'seasonal_naive',
  'random_forest',
  'hist_gradient_boosting',
] as const satisfies readonly CandidateModelName[]

export const candidateModelSchema = z.enum(CANDIDATE_MODELS)

/** docs/14 preferred_model — omit for AI default (LLM when OpenAI key set); `llm` → OpenAI/Ollama. */
const PREFERRED_FORECAST_MODELS = [
  'historical_average',
  'moving_average',
  'seasonal_naive',
  'random_forest',
  'hist_gradient_boosting',
  'llm',
] as const satisfies readonly PreferredForecastModel[]

export const preferredForecastModelSchema = z.enum(PREFERRED_FORECAST_MODELS)

/**
 * Calendar date `YYYY-MM-DD`.
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

function refineBloodGroupRequired<
  T extends { bloodGroupId?: number; bloodGroup?: string },
>(value: T, ctx: z.RefinementCtx): void {
  if (value.bloodGroupId === undefined && value.bloodGroup === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'bloodGroup or bloodGroupId is required',
      path: ['bloodGroup'],
    })
  }
}

/** History point matching docs/14 ForecastRequest.history. */
export const historyPointSchema = z
  .object({
    date: dateOnlySchema,
    demand_units: z.coerce
      .number({ invalid_type_error: 'demand_units must be a number' })
      .finite('demand_units must be finite')
      .min(0, 'demand_units must be >= 0'),
  })
  .strict()

/**
 * POST /predictions/run body.
 * Optionally syncs demand, optionally trains, then forecasts and persists.
 */
export const runPredictionBodySchema = z
  .object({
    bloodGroupId: optionalPositiveId('bloodGroupId'),
    bloodGroup: bloodGroupCodeSchema.optional(),
    facilityId: optionalPositiveId('facilityId'),
    horizonDays: horizonDaysSchema.optional().default(7 as HorizonDays),
    /** Rebuild BLOOD_REQUEST demand_records before exporting history. */
    syncDemand: z.boolean().optional().default(false),
    /** Call AI POST /train before forecast (longer timeout; opt-in). */
    train: z.boolean().optional().default(false),
    candidateModels: z.array(candidateModelSchema).min(1).optional(),
    /**
     * Forecast model preference forwarded as AI `preferred_model`.
     * Omit / null → AI default (LLM when OpenAI configured); `llm` uses OpenAI (primary) or Ollama.
     */
    preferredModel: preferredForecastModelSchema.nullish(),
    /** History window when loading from demand_records. */
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    /**
     * Inline history override (docs/14). When omitted, API exports from
     * demand_records for the blood group / facility.
     */
    history: z.array(historyPointSchema).min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    refineDateRange(value, ctx)
    refineBloodGroupExclusive(value, ctx)
    refineBloodGroupRequired(value, ctx)
    if (value.candidateModels && !value.train) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'candidateModels requires train=true',
        path: ['candidateModels'],
      })
    }
  })
  .transform((value) => ({
    ...value,
    preferredModel: value.preferredModel ?? undefined,
  }))

export type RunPredictionBody = z.infer<typeof runPredictionBodySchema>

export const listPredictionsQuerySchema = z
  .object({
    bloodGroupId: optionalPositiveId('bloodGroupId'),
    bloodGroup: bloodGroupCodeSchema.optional(),
    facilityId: optionalPositiveId('facilityId'),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    ...paginationSchema,
  })
  .superRefine((value, ctx) => {
    refineDateRange(value, ctx)
    refineBloodGroupExclusive(value, ctx)
  })

export type ListPredictionsQuery = z.infer<typeof listPredictionsQuerySchema>

/**
 * GET /predictions/latest — blood group required; optional facility scope.
 */
export const latestPredictionQuerySchema = z
  .object({
    bloodGroupId: optionalPositiveId('bloodGroupId'),
    bloodGroup: bloodGroupCodeSchema.optional(),
    facilityId: optionalPositiveId('facilityId'),
  })
  .superRefine((value, ctx) => {
    refineBloodGroupExclusive(value, ctx)
    refineBloodGroupRequired(value, ctx)
  })

export type LatestPredictionQuery = z.infer<typeof latestPredictionQuerySchema>

export const predictionIdParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'id must be a number' })
    .int('id must be an integer')
    .positive('id must be positive'),
})

export type PredictionIdParam = z.infer<typeof predictionIdParamSchema>
