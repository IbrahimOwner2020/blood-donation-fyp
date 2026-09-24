/**
 * Zod schemas for donation CRUD + list filters (TODO.md §4, docs/04, docs/06).
 */

import { z } from 'zod'

import { BLOOD_GROUP_SEEDS } from '../../db/seed/blood-groups-data'
import { donationCategories } from '../../db/schema/enums'
import { createDonorBodySchema } from '../donors/schemas'

const BLOOD_GROUP_CODES = BLOOD_GROUP_SEEDS.map((g) => g.code) as [
  string,
  ...string[],
]

export const bloodGroupCodeSchema = z.enum(BLOOD_GROUP_CODES)

const positiveId = (label: string) =>
  z
    .number({
      required_error: `${label} is required`,
      invalid_type_error: `${label} must be a number`,
    })
    .int(`${label} must be an integer`)
    .positive(`${label} must be positive`)

const unitsSchema = z
  .number({
    required_error: 'Units is required',
    invalid_type_error: 'Units must be a number',
  })
  .int('Units must be an integer')
  .positive('Units must be at least 1')
  .max(50, 'Units must be at most 50')

/**
 * Calendar date `YYYY-MM-DD` (donation_date is a DATE column).
 */
const dateOnlySchema = z
  .string({
    required_error: 'Donation date is required',
    invalid_type_error: 'Donation date must be a string',
  })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Donation date must be YYYY-MM-DD')
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
  }, 'Donation date must be a valid calendar date')

const notesSchema = z.preprocess((raw) => {
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
  z.string().max(5000, 'Notes must be at most 5000 characters'),
  z.null(),
]).optional())

export const donationIdParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'Donation id must be a number' })
    .int('Donation id must be an integer')
    .positive('Donation id must be positive'),
})

export type DonationIdParam = z.infer<typeof donationIdParamSchema>

const donationBaseSchema = z.object({
  donorId: positiveId('Donor id').optional(),
  newDonor: createDonorBodySchema
    .omit({ donorNumber: true, eligibilityStatus: true, active: true })
    .optional(),
  donationCentreId: positiveId('Donation centre id'),
  bloodGroupId: positiveId('Blood group id'),
  donationDate: dateOnlySchema,
  category: z.enum(donationCategories).optional().default('VOLUNTARY'),
  weightKgAtDonation: z.coerce
    .number({ required_error: 'Donation weight is required' })
    .positive('Donation weight must be positive')
    .max(300, 'Donation weight must be at most 300 kg'),
  /** Number of unit-level inventory rows to create (default 1). */
  units: unitsSchema.optional().default(1),
  notes: notesSchema,
  /**
   * Optional facility assignment for created inventory units.
   * Omitted / null → unassigned stock.
   */
  facilityId: z
    .number({ invalid_type_error: 'Facility id must be a number' })
    .int('Facility id must be an integer')
    .positive('Facility id must be positive')
    .nullable()
    .optional(),
})

export const createDonationBodySchema = donationBaseSchema.superRefine(
  (body, ctx) => {
    if ((body.donorId ? 1 : 0) + (body.newDonor ? 1 : 0) !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['donorId'],
        message: 'Select an existing donor or provide one new donor',
      })
    }
    if (body.newDonor && body.newDonor.bloodGroupId !== body.bloodGroupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bloodGroupId'],
        message: 'Donation blood group must match the new donor blood group',
      })
    }
  },
)

export type CreateDonationBody = z.infer<typeof createDonationBodySchema>

/**
 * PATCH — notes and/or centre correction.
 * Units / blood group / donor are immutable after inventory is linked on create.
 * (RBAC has donations:create only — no donations:update; same pattern as centres.)
 */
export const updateDonationBodySchema = z
  .object({
    notes: notesSchema,
    donationCentreId: z
      .number({ invalid_type_error: 'Donation centre id must be a number' })
      .int('Donation centre id must be an integer')
      .positive('Donation centre id must be positive')
      .optional(),
  })
  .refine(
    (body) =>
      body.notes !== undefined || body.donationCentreId !== undefined,
    { message: 'At least one field is required' },
  )

export type UpdateDonationBody = z.infer<typeof updateDonationBodySchema>

export const listDonationsQuerySchema = z.object({
  donorId: z.coerce
    .number({ invalid_type_error: 'donorId must be a number' })
    .int('donorId must be an integer')
    .positive('donorId must be positive')
    .optional(),
  donationCentreId: z.coerce
    .number({ invalid_type_error: 'donationCentreId must be a number' })
    .int('donationCentreId must be an integer')
    .positive('donationCentreId must be positive')
    .optional(),
  facilityId: z.coerce
    .number({ invalid_type_error: 'facilityId must be a number' })
    .int('facilityId must be an integer')
    .positive('facilityId must be positive')
    .optional(),
  bloodGroupId: z.coerce
    .number({ invalid_type_error: 'bloodGroupId must be a number' })
    .int('bloodGroupId must be an integer')
    .positive('bloodGroupId must be positive')
    .optional(),
  bloodGroup: bloodGroupCodeSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export type ListDonationsQuery = z.infer<typeof listDonationsQuerySchema>
