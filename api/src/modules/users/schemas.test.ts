/**
 * Unit tests for admin user Zod schemas (no DB).
 */

import { describe, expect, test } from 'bun:test'

import {
  assignUserRolesBodySchema,
  createRoleBodySchema,
  createUserBodySchema,
  listUsersQuerySchema,
  patchUserBodySchema,
  roleIdParamSchema,
  updateRoleBodySchema,
  userIdParamSchema,
} from './schemas'

describe('users schemas', () => {
  test('createUserBodySchema hashes-ready fields and lowercases email', () => {
    const parsed = createUserBodySchema.parse({
      name: '  Ada Admin ',
      email: 'Ada@Example.com',
      password: 'secretpass',
      roleIds: ['1', 2],
    })

    expect(parsed.name).toBe('Ada Admin')
    expect(parsed.email).toBe('ada@example.com')
    expect(parsed.status).toBe('ACTIVE')
    expect(parsed.roleIds).toEqual([1, 2])
  })

  test('createUserBodySchema rejects short passwords', () => {
    const result = createUserBodySchema.safeParse({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'short',
    })
    expect(result.success).toBe(false)
  })

  test('patchUserBodySchema requires at least one field', () => {
    expect(patchUserBodySchema.safeParse({}).success).toBe(false)
    expect(
      patchUserBodySchema.safeParse({ status: 'INACTIVE' }).success,
    ).toBe(true)
  })

  test('listUsersQuerySchema and userIdParamSchema coerce inputs', () => {
    expect(listUsersQuerySchema.parse({ status: 'ACTIVE', q: ' ada ' })).toEqual({
      status: 'ACTIVE',
      q: 'ada',
    })
    expect(userIdParamSchema.parse({ id: '42' })).toEqual({ id: 42 })
  })

  test('assignUserRolesBodySchema accepts empty role list', () => {
    expect(assignUserRolesBodySchema.parse({ roleIds: [] })).toEqual({
      roleIds: [],
    })
  })

  test('createRoleBodySchema trims name and nulls empty description', () => {
    const parsed = createRoleBodySchema.parse({
      name: '  Analyst ',
      description: '  ',
      permissionCodes: ['donors:read', 'reports:read'],
    })
    expect(parsed.name).toBe('Analyst')
    expect(parsed.description).toBeNull()
    expect(parsed.permissionCodes).toEqual(['donors:read', 'reports:read'])
  })

  test('updateRoleBodySchema requires at least one field', () => {
    expect(updateRoleBodySchema.safeParse({}).success).toBe(false)
    expect(
      updateRoleBodySchema.safeParse({ permissionCodes: [] }).success,
    ).toBe(true)
  })

  test('roleIdParamSchema coerces id', () => {
    expect(roleIdParamSchema.parse({ id: '9' })).toEqual({ id: 9 })
  })
})
