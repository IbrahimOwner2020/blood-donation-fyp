/**
 * Zod schemas for shortage alert routes (docs/04 alerts/, docs/06, docs/08).
 */

import { z } from 'zod'

import {
  alertSeverities,
  alertStatuses,
} from '../../db/schema/enums'
import { BLOOD_GROUP_SEEDS } from '../../db/seed/blood-groups-data'

const BLOOD_GROUP_CODES = BLOOD_GROUP_SEEDS.map((g) => g.code) as [
  string,
  ...string[],
]

export const bloodGroupCodeSchema = z.enum(BLOOD_GROUP_CODES)
export const alertSeveritySchema = z.enum(alertSeverities)
export const alertStatusSchema = z.enum(alertStatuses)

export const alertIdParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'Alert id must be a number' })
    .int('Alert id must be an integer')
    .positive('Alert id must be positive'),
})

export type AlertIdParam = z.infer<typeof alertIdParamSchema>

export const listAlertsQuerySchema = z.object({
  bloodGroupId: z.coerce
    .number({ invalid_type_error: 'bloodGroupId must be a number' })
    .int('bloodGroupId must be an integer')
    .positive('bloodGroupId must be positive')
    .optional(),
  bloodGroup: bloodGroupCodeSchema.optional(),
  facilityId: z.coerce
    .number({ invalid_type_error: 'facilityId must be a number' })
    .int('facilityId must be an integer')
    .positive('facilityId must be positive')
    .optional(),
  status: alertStatusSchema.optional(),
  severity: alertSeveritySchema.optional(),
  /** When true, only OPEN + ACKNOWLEDGED. */
  activeOnly: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>

export const patchAlertStatusBodySchema = z.object({
  status: alertStatusSchema,
})

export type PatchAlertStatusBody = z.infer<typeof patchAlertStatusBodySchema>

/**
 * Recalculate shortage for one prediction, one blood group, or all groups
 * that have a latest prediction.
 */
export const recalculateAlertsBodySchema = z
  .object({
    predictionId: z
      .number({ invalid_type_error: 'predictionId must be a number' })
      .int('predictionId must be an integer')
      .positive('predictionId must be positive')
      .optional(),
    bloodGroupId: z
      .number({ invalid_type_error: 'bloodGroupId must be a number' })
      .int('bloodGroupId must be an integer')
      .positive('bloodGroupId must be positive')
      .optional(),
    bloodGroup: bloodGroupCodeSchema.optional(),
    facilityId: z
      .number({ invalid_type_error: 'facilityId must be a number' })
      .int('facilityId must be an integer')
      .positive('facilityId must be positive')
      .nullable()
      .optional(),
  })
  .refine(
    (body) =>
      !(
        body.bloodGroupId !== undefined &&
        body.bloodGroup !== undefined
      ),
    {
      message: 'Provide bloodGroupId or bloodGroup, not both',
      path: ['bloodGroup'],
    },
  )

export type RecalculateAlertsBody = z.infer<typeof recalculateAlertsBodySchema>

/**
 * Pagination for GET /alerts/:id/matches (on-demand donor matching).
 */
export const listAlertMatchesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export type ListAlertMatchesQuery = z.infer<typeof listAlertMatchesQuerySchema>
