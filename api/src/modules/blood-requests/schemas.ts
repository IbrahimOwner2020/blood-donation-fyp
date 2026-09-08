/**
 * Zod schemas for blood request routes (docs/04 blood-requests/, docs/06 blood_requests).
 */

import { z } from 'zod'

import {
  bloodRequestPriorities,
  bloodRequestStatuses,
} from '../../db/schema/enums'

export const bloodRequestStatusSchema = z.enum(bloodRequestStatuses)
export const bloodRequestPrioritySchema = z.enum(bloodRequestPriorities)

const positiveId = (label: string) =>
  z
    .number({
      required_error: `${label} is required`,
      invalid_type_error: `${label} must be a number`,
    })
    .int(`${label} must be an integer`)
    .positive(`${label} must be positive`)

const unitsRequestedSchema = z
  .number({
    required_error: 'Units requested is required',
    invalid_type_error: 'Units requested must be a number',
  })
  .int('Units requested must be an integer')
  .positive('Units requested must be at least 1')
  .max(10_000, 'Units requested must be at most 10000')

const fulfilledUnitsSchema = z
  .number({
    invalid_type_error: 'Fulfilled units must be a number',
  })
  .int('Fulfilled units must be an integer')
  .min(0, 'Fulfilled units must be at least 0')
  .max(10_000, 'Fulfilled units must be at most 10000')

/**
 * Accept ISO-8601 datetime strings (or Date) → Date.
 * Empty string / null → null (for optional requiredAt clear).
 */
const optionalDateTimeSchema = z.preprocess((raw) => {
  if (raw === undefined) {
    return undefined
  }
  if (raw === null || raw === '') {
    return null
  }
  if (raw instanceof Date) {
    return raw
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return null
    }
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) {
      return raw
    }
    return parsed
  }
  return raw
}, z.union([z.date({ invalid_type_error: 'Must be a valid ISO-8601 datetime' }), z.null()]).optional())

const requestedAtSchema = z.preprocess((raw) => {
  if (raw === undefined || raw === null || raw === '') {
    return undefined
  }
  if (raw instanceof Date) {
    return raw
  }
  if (typeof raw === 'string') {
    const parsed = new Date(raw.trim())
    if (Number.isNaN(parsed.getTime())) {
      return raw
    }
    return parsed
  }
  return raw
}, z.date({ invalid_type_error: 'requestedAt must be a valid ISO-8601 datetime' }).optional())

export const bloodRequestIdParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'Blood request id must be a number' })
    .int('Blood request id must be an integer')
    .positive('Blood request id must be positive'),
})

export type BloodRequestIdParam = z.infer<typeof bloodRequestIdParamSchema>

export const listBloodRequestsQuerySchema = z.object({
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
  status: bloodRequestStatusSchema.optional(),
  priority: bloodRequestPrioritySchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export type ListBloodRequestsQuery = z.infer<typeof listBloodRequestsQuerySchema>

export const createBloodRequestBodySchema = z.object({
  facilityId: positiveId('Facility id'),
  bloodGroupId: positiveId('Blood group id'),
  unitsRequested: unitsRequestedSchema,
  /** Urgency — maps to docs priority (LOW | MEDIUM | HIGH | URGENT). */
  priority: bloodRequestPrioritySchema.optional().default('MEDIUM'),
  requestedAt: requestedAtSchema,
  requiredAt: optionalDateTimeSchema,
})

export type CreateBloodRequestBody = z.infer<typeof createBloodRequestBodySchema>

/**
 * PATCH body — status change and/or fulfilment update (requests:update).
 * Status is required; fulfilledUnits required when entering/staying PARTIAL.
 */
export const patchBloodRequestBodySchema = z
  .object({
    status: bloodRequestStatusSchema,
    fulfilledUnits: fulfilledUnitsSchema.optional(),
  })
  .strict()

export type PatchBloodRequestBody = z.infer<typeof patchBloodRequestBodySchema>
