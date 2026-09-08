/**
 * Zod schemas for healthcare facility routes (docs/04 facilities/, docs/06 healthcare_facilities).
 */

import { z } from 'zod'

const nameSchema = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(255, 'Name must be at most 255 characters')

const regionSchema = z
  .string({ required_error: 'Region is required' })
  .trim()
  .min(1, 'Region is required')
  .max(120, 'Region must be at most 120 characters')

const districtSchema = z
  .string({ required_error: 'District is required' })
  .trim()
  .min(1, 'District is required')
  .max(120, 'District must be at most 120 characters')

const activeSchema = z.boolean({
  required_error: 'Active is required',
  invalid_type_error: 'Active must be a boolean',
})

/** Coerce common query string booleans ("true"/"false"/"1"/"0"). */
const queryBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined
    }
    if (typeof value === 'boolean') {
      return value
    }
    return value === 'true' || value === '1'
  })

export const facilityIdParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'Facility id must be a number' })
    .int('Facility id must be an integer')
    .positive('Facility id must be positive'),
})

export const listFacilitiesQuerySchema = z.object({
  region: z.string().trim().min(1).max(120).optional(),
  district: z.string().trim().min(1).max(120).optional(),
  active: queryBooleanSchema,
  q: z.string().trim().min(1).max(255).optional(),
})

export const createFacilityBodySchema = z.object({
  name: nameSchema,
  region: regionSchema,
  district: districtSchema,
  active: activeSchema.optional().default(true),
})

export const patchFacilityBodySchema = z
  .object({
    name: nameSchema.optional(),
    region: regionSchema.optional(),
    district: districtSchema.optional(),
    active: activeSchema.optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.region !== undefined ||
      body.district !== undefined ||
      body.active !== undefined,
    { message: 'At least one field is required' },
  )

export type FacilityIdParam = z.infer<typeof facilityIdParamSchema>
export type ListFacilitiesQuery = z.infer<typeof listFacilitiesQuerySchema>
export type CreateFacilityBody = z.infer<typeof createFacilityBodySchema>
export type PatchFacilityBody = z.infer<typeof patchFacilityBodySchema>
