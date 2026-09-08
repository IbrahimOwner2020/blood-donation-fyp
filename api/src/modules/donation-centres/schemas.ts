/**
 * Zod schemas for donation centre routes (docs/04, docs/06 donation_centres).
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

const addressSchema = z
  .string()
  .trim()
  .max(2000, 'Address must be at most 2000 characters')
  .nullable()
  .optional()

/** Query `active` — accept true/false/1/0 (avoid z.coerce.boolean). */
const activeQuerySchema = z
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

export const listDonationCentresQuerySchema = z.object({
  region: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional(),
  active: activeQuerySchema,
})

export type ListDonationCentresQuery = z.infer<typeof listDonationCentresQuerySchema>

export const donationCentreIdParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'id must be a number' })
    .int('id must be an integer')
    .positive('id must be a positive integer'),
})

export type DonationCentreIdParam = z.infer<typeof donationCentreIdParamSchema>

export const createDonationCentreBodySchema = z.object({
  name: nameSchema,
  region: regionSchema,
  address: addressSchema,
  active: z.boolean().optional().default(true),
})

export type CreateDonationCentreBody = z.infer<typeof createDonationCentreBodySchema>

export const patchDonationCentreBodySchema = z
  .object({
    name: nameSchema.optional(),
    region: regionSchema.optional(),
    address: addressSchema,
    active: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.region !== undefined ||
      body.address !== undefined ||
      body.active !== undefined,
    { message: 'At least one field is required' },
  )

export type PatchDonationCentreBody = z.infer<typeof patchDonationCentreBodySchema>
