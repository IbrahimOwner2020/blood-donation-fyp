/**
 * Zod schemas for admin users / roles routes (docs/04 Users and Roles).
 */

import { z } from 'zod'

import { userStatuses } from '../../db/schema/enums'

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

const roleIdsSchema = z
  .array(z.coerce.number().int().positive())
  .max(50)
  .optional()

export const listUsersQuerySchema = z.object({
  status: z.enum(userStatuses).optional(),
  q: z.string().trim().max(255).optional(),
})

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>

export const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive('User id must be a positive integer'),
})

export type UserIdParam = z.infer<typeof userIdParamSchema>

export const createUserBodySchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  status: z.enum(userStatuses).optional().default('ACTIVE'),
  /** Optional initial role assignment; requires roles:manage when provided. */
  roleIds: roleIdsSchema,
})

export type CreateUserBody = z.infer<typeof createUserBodySchema>

export const patchUserBodySchema = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    status: z.enum(userStatuses).optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.email !== undefined ||
      body.password !== undefined ||
      body.status !== undefined,
    { message: 'At least one field is required' },
  )

export type PatchUserBody = z.infer<typeof patchUserBodySchema>

export const assignUserRolesBodySchema = z.object({
  roleIds: z.array(z.coerce.number().int().positive()).max(50),
})

export type AssignUserRolesBody = z.infer<typeof assignUserRolesBodySchema>

const roleNameSchema = z
  .string({ required_error: 'Role name is required' })
  .trim()
  .min(1, 'Role name is required')
  .max(100, 'Role name must be at most 100 characters')

const roleDescriptionSchema = z.preprocess((raw) => {
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
}, z.union([z.string().max(2000, 'Description must be at most 2000 characters'), z.null()]).optional())

export const roleIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Role id must be a positive integer'),
})

export type RoleIdParam = z.infer<typeof roleIdParamSchema>

export const createRoleBodySchema = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema,
})

export type CreateRoleBody = z.infer<typeof createRoleBodySchema>

export const updateRoleBodySchema = z
  .object({
    name: roleNameSchema.optional(),
    description: roleDescriptionSchema,
  })
  .refine(
    (body) => body.name !== undefined || body.description !== undefined,
    { message: 'At least one field is required' },
  )

export type UpdateRoleBody = z.infer<typeof updateRoleBodySchema>
