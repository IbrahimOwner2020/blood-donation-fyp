/**
 * Zod schemas for auth routes (docs/04).
 */

import { z } from 'zod'

export const loginBodySchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .email('Invalid email address')
    .max(255),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required')
    .max(256),
})

export type LoginBody = z.infer<typeof loginBodySchema>

const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .email('Invalid email address')
  .max(255)
  .transform((value) => value.toLowerCase())

const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(256)

const nameSchema = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(255)

const donorNameSchema = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(120, `${label} must be at most 120 characters`)

const phoneSchema = z
  .string({ required_error: 'Phone is required' })
  .trim()
  .min(7, 'Phone must be at least 7 characters')
  .max(32, 'Phone must be at most 32 characters')

export const registerDonorBodySchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  firstName: donorNameSchema('First name'),
  lastName: donorNameSchema('Last name'),
  phone: phoneSchema,
  bloodGroupId: z
    .number({ required_error: 'Blood group is required' })
    .int('Blood group id must be an integer')
    .positive('Blood group id must be positive'),
})

export type RegisterDonorBody = z.infer<typeof registerDonorBodySchema>

/**
 * Authenticated password change (docs/04 POST /auth/change-password).
 * currentPassword verified against stored Argon2id hash; newPassword re-hashed.
 */
export const changePasswordBodySchema = z
  .object({
    currentPassword: z
      .string({ required_error: 'Current password is required' })
      .min(1, 'Current password is required')
      .max(256),
    newPassword: z
      .string({ required_error: 'New password is required' })
      .min(8, 'New password must be at least 8 characters')
      .max(256),
  })
  .refine((body) => body.currentPassword !== body.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  })

export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>
