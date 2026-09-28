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
