/**
 * Zod schemas for donor CRUD + list filters (TODO.md §3, docs/04, docs/06).
 * Eligibility uses “potentially eligible” wording only — never medical approval.
 */

import { z } from 'zod'

import { donorEligibilityStatuses } from '../../db/schema/enums'
import { BLOOD_GROUP_SEEDS } from '../../db/seed/blood-groups-data'

const BLOOD_GROUP_CODES = BLOOD_GROUP_SEEDS.map((g) => g.code) as [
  string,
  ...string[],
]

export const donorEligibilityStatusSchema = z.enum(donorEligibilityStatuses)

export const bloodGroupCodeSchema = z.enum(BLOOD_GROUP_CODES)

const donorNumberSchema = z
  .string({ required_error: 'Donor number is required' })
  .trim()
  .min(1, 'Donor number is required')
  .max(64, 'Donor number must be at most 64 characters')

const firstNameSchema = z
  .string({ required_error: 'First name is required' })
  .trim()
  .min(1, 'First name is required')
  .max(120, 'First name must be at most 120 characters')

const lastNameSchema = z
  .string({ required_error: 'Last name is required' })
  .trim()
  .min(1, 'Last name is required')
  .max(120, 'Last name must be at most 120 characters')

/**
 * Optional contact phone. Empty string / null → null (unique indexes).
 */
const phoneSchema = z.preprocess((raw) => {
  if (raw === undefined) {
    return undefined
  }
  if (raw === null) {
    return null
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed.length === 0 ? null : trimmed
  }
  return raw
}, z.union([
  z
    .string()
    .min(7, 'Phone must be at least 7 characters')
    .max(32, 'Phone must be at most 32 characters'),
  z.null(),
]).optional())

/**
 * Optional contact email. Empty string / null → null.
 */
const emailSchema = z.preprocess((raw) => {
  if (raw === undefined) {
    return undefined
  }
  if (raw === null) {
    return null
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed.length === 0 ? null : trimmed
  }
  return raw
}, z.union([
  z.string().email('Invalid email address').max(255, 'Email must be at most 255 characters'),
  z.null(),
]).optional())

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

export const donorIdParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'Donor id must be a number' })
    .int('Donor id must be an integer')
    .positive('Donor id must be positive'),
})

export type DonorIdParam = z.infer<typeof donorIdParamSchema>

export const createDonorBodySchema = z.object({
  donorNumber: donorNumberSchema,
  firstName: firstNameSchema,
  lastName: lastNameSchema,
  phone: phoneSchema,
  email: emailSchema,
  bloodGroupId: z
    .number({ required_error: 'Blood group is required' })
    .int('Blood group id must be an integer')
    .positive('Blood group id must be positive'),
  /**
   * Operational status only — POTENTIALLY_ELIGIBLE is not a medical clearance.
   */
  eligibilityStatus: donorEligibilityStatusSchema.optional().default('UNKNOWN'),
  active: z.boolean().optional().default(true),
})

export type CreateDonorBody = z.infer<typeof createDonorBodySchema>

export const updateDonorBodySchema = z
  .object({
    donorNumber: donorNumberSchema.optional(),
    firstName: firstNameSchema.optional(),
    lastName: lastNameSchema.optional(),
    phone: phoneSchema,
    email: emailSchema,
    bloodGroupId: z
      .number()
      .int('Blood group id must be an integer')
      .positive('Blood group id must be positive')
      .optional(),
    eligibilityStatus: donorEligibilityStatusSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.donorNumber !== undefined ||
      body.firstName !== undefined ||
      body.lastName !== undefined ||
      body.phone !== undefined ||
      body.email !== undefined ||
      body.bloodGroupId !== undefined ||
      body.eligibilityStatus !== undefined ||
      body.active !== undefined,
    { message: 'At least one field is required' },
  )

export type UpdateDonorBody = z.infer<typeof updateDonorBodySchema>

export const listDonorsQuerySchema = z.object({
  bloodGroupId: z.coerce
    .number({ invalid_type_error: 'bloodGroupId must be a number' })
    .int('bloodGroupId must be an integer')
    .positive('bloodGroupId must be positive')
    .optional(),
  bloodGroup: bloodGroupCodeSchema.optional(),
  /**
   * Donors who have at least one donation recorded at this centre
   * (donors table has no home-centre column).
   */
  donationCentreId: z.coerce
    .number({ invalid_type_error: 'donationCentreId must be a number' })
    .int('donationCentreId must be an integer')
    .positive('donationCentreId must be positive')
    .optional(),
  active: queryBooleanSchema,
  eligibilityStatus: donorEligibilityStatusSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export type ListDonorsQuery = z.infer<typeof listDonorsQuerySchema>
