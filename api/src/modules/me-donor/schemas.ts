/**
 * Self-service donor profile schemas. Account email/password remain auth-owned.
 */

import { z } from 'zod'

const nameSchema = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(120, `${label} must be at most 120 characters`)

const phoneSchema = z.preprocess((raw) => {
  if (raw === undefined) return undefined
  if (raw === null) return null
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

export const updateOwnDonorBodySchema = z
  .object({
    firstName: nameSchema('First name').optional(),
    lastName: nameSchema('Last name').optional(),
    phone: phoneSchema,
    bloodGroupId: z
      .number()
      .int('Blood group id must be an integer')
      .positive('Blood group id must be positive')
      .optional(),
  })
  .refine(
    (body) =>
      body.firstName !== undefined ||
      body.lastName !== undefined ||
      body.phone !== undefined ||
      body.bloodGroupId !== undefined,
    { message: 'At least one field is required' },
  )

export type UpdateOwnDonorBody = z.infer<typeof updateOwnDonorBodySchema>
