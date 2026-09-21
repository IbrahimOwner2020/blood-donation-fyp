/**
 * Admin users / roles persistence (docs/04, docs/06, docs/10).
 * Soft-deactivate via status=INACTIVE; never returns passwordHash.
 */

import { and, asc, eq, inArray, like, ne, or, type SQL } from 'drizzle-orm'

import type { Db, DbTransaction } from '../../db'
import { withTransaction } from '../../db'
import {
  healthcareFacilities,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../../db/schema'
import type { UserStatus } from '../../db/schema/enums'
import { AppError } from '../../lib/errors'
import type { AuthUser } from '../../lib/types'
import {
  FACILITY_ASSIGNABLE_PERMISSION_CODES,
  isFacilityAssignableRoleName,
  requireAssignedFacilityId,
} from '../auth/access-scope'
import { hashPassword } from '../auth/password'
import { revokeAllUserSessions } from '../auth/sessions'
import type {
  AdminRoleSummary,
  AdminUser,
  PermissionListItem,
  RoleListItem,
  UserRowWithoutHash,
} from './serialize'
import { toAdminUser } from './serialize'
import type {
  AssignUserRolesBody,
  CreateRoleBody,
  CreateUserBody,
  ListUsersQuery,
  PatchUserBody,
  UpdateRoleBody,
} from './schemas'

/** Db or in-transaction client (same query surface for these helpers). */
type DbLike = Db | DbTransaction

export type UserManagementScope = {
  actor: AuthUser | null | undefined
  permissions: readonly string[]
}

function hasPermission(
  granted: readonly string[] | null | undefined,
  code: string,
): boolean {
  return (granted ?? []).includes(code)
}

function isGlobalUserManager(scope?: UserManagementScope): boolean {
  return hasPermission(scope?.permissions, 'users:manage')
}

function isFacilityUserManager(scope?: UserManagementScope): boolean {
  return hasPermission(scope?.permissions, 'users:manage:facility')
}

function canManageUsers(scope?: UserManagementScope): boolean {
  return isGlobalUserManager(scope) || isFacilityUserManager(scope)
}

function canManageRoles(scope?: UserManagementScope): boolean {
  return hasPermission(scope?.permissions, 'roles:manage')
}

function canAssignFacilityRoles(scope?: UserManagementScope): boolean {
  return hasPermission(scope?.permissions, 'roles:assign:facility')
}

function scopedFacilityId(scope?: UserManagementScope): number | undefined {
  if (!scope || isGlobalUserManager(scope)) {
    return undefined
  }
  if (!isFacilityUserManager(scope)) {
    throw AppError.forbidden('Insufficient permissions')
  }
  return requireAssignedFacilityId(scope.actor)
}

function assertFacilityScopedUserTarget(
  scope: UserManagementScope | undefined,
  facilityId: number | null | undefined,
): void {
  const requiredFacilityId = scopedFacilityId(scope)
  if (requiredFacilityId === undefined) {
    return
  }
  if (facilityId !== requiredFacilityId) {
    throw AppError.forbidden('Facility managers can only manage users in their assigned facility')
  }
}

const USER_SELECT = {
  id: users.id,
  name: users.name,
  email: users.email,
  facilityId: users.facilityId,
  status: users.status,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const

function mapUserRow(
  row: {
    id: number
    name: string
    email: string
    facilityId: number | null
    status: UserStatus
    createdAt: Date
    updatedAt: Date
  } | null | undefined,
): UserRowWithoutHash | null {
  if (!row) {
    return null
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    facilityId: row.facilityId ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function isDuplicateEmailError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code =
    'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : ''
  const errno =
    'errno' in error && typeof (error as { errno?: unknown }).errno === 'number'
      ? (error as { errno: number }).errno
      : undefined
  const message =
    error instanceof Error
      ? error.message
      : 'message' in error && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : ''
  return (
    code === 'ER_DUP_ENTRY' ||
    errno === 1062 ||
    message.toLowerCase().includes('duplicate')
  )
}

async function loadRolesForUserIds(
  db: DbLike,
  userIds: number[],
): Promise<Map<number, AdminRoleSummary[]>> {
  const map = new Map<number, AdminRoleSummary[]>()
  if (!userIds?.length) {
    return map
  }

  const rows = await db
    .select({
      userId: userRoles.userId,
      roleId: roles.id,
      roleName: roles.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(inArray(userRoles.userId, userIds))
    .orderBy(asc(roles.name))

  for (const row of rows ?? []) {
    if (typeof row?.userId !== 'number' || typeof row?.roleId !== 'number') {
      continue
    }
    const list = map.get(row.userId) ?? []
    list.push({ id: row.roleId, name: row.roleName ?? '' })
    map.set(row.userId, list)
  }

  return map
}

async function assertRolesExist(db: DbLike, roleIds: number[]): Promise<void> {
  const uniqueIds = [...new Set((roleIds ?? []).filter((id) => id > 0))]
  if (uniqueIds.length === 0) {
    return
  }

  const found = await db
    .select({ id: roles.id })
    .from(roles)
    .where(inArray(roles.id, uniqueIds))

  const foundIds = new Set((found ?? []).map((row) => row?.id).filter(Boolean))
  const missing = uniqueIds.filter((id) => !foundIds.has(id))
  if (missing.length > 0) {
    throw AppError.badRequest('One or more role ids are invalid', [
      {
        path: 'roleIds',
        message: `Unknown role id(s): ${missing.join(', ')}`,
      },
    ])
  }
}

async function roleNamesForIds(
  db: DbLike,
  roleIds: number[],
): Promise<string[]> {
  const uniqueIds = [...new Set((roleIds ?? []).filter((id) => id > 0))]
  if (uniqueIds.length === 0) {
    return []
  }
  const rows = await db
    .select({ name: roles.name })
    .from(roles)
    .where(inArray(roles.id, uniqueIds))
  return (rows ?? [])
    .map((row) => row?.name?.trim())
    .filter((name): name is string => Boolean(name))
}

async function permissionCodesForRoleIds(
  db: DbLike,
  roleIds: number[],
): Promise<Map<number, string[]>> {
  const uniqueIds = [...new Set((roleIds ?? []).filter((id) => id > 0))]
  const map = new Map<number, string[]>()
  if (uniqueIds.length === 0) {
    return map
  }

  const rows = await db
    .select({
      roleId: rolePermissions.roleId,
      code: permissions.code,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(inArray(rolePermissions.roleId, uniqueIds))

  for (const row of rows ?? []) {
    if (typeof row?.roleId !== 'number' || !row?.code) {
      continue
    }
    const list = map.get(row.roleId) ?? []
    list.push(row.code)
    map.set(row.roleId, list)
  }
  return map
}

async function assertFacilityAssignableRoles(
  db: DbLike,
  roleIds: number[],
): Promise<void> {
  const uniqueIds = [...new Set((roleIds ?? []).filter((id) => id > 0))]
  if (uniqueIds.length === 0) {
    return
  }

  const roleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(inArray(roles.id, uniqueIds))
  const permissionMap = await permissionCodesForRoleIds(db, uniqueIds)
  const allowed = new Set<string>(FACILITY_ASSIGNABLE_PERMISSION_CODES)

  for (const role of roleRows ?? []) {
    if (!isFacilityAssignableRoleName(role.name)) {
      throw AppError.forbidden('Facility managers cannot assign system-level roles')
    }
    const codes = permissionMap.get(role.id) ?? []
    const unsafe = codes.filter((code) => !allowed.has(code))
    if (unsafe.length > 0) {
      throw AppError.forbidden(
        `Role "${role.name}" includes permissions outside the facility-safe set`,
      )
    }
  }
}

async function replaceRolePermissions(
  db: DbLike,
  roleId: number,
  permissionCodes: readonly string[],
): Promise<void> {
  const uniqueCodes = [...new Set((permissionCodes ?? []).filter(Boolean))]
  const rows =
    uniqueCodes.length === 0
      ? []
      : await db
          .select({ id: permissions.id, code: permissions.code })
          .from(permissions)
          .where(inArray(permissions.code, uniqueCodes))

  const foundCodes = new Set((rows ?? []).map((row) => row.code))
  const missing = uniqueCodes.filter((code) => !foundCodes.has(code))
  if (missing.length > 0) {
    throw AppError.badRequest('One or more permission codes are invalid', [
      {
        path: 'permissionCodes',
        message: `Unknown permission code(s): ${missing.join(', ')}`,
      },
    ])
  }

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))

  if (uniqueCodes.length === 0) {
    return
  }

  await db.insert(rolePermissions).values(
    rows.map((row) => ({
      roleId,
      permissionId: row.id,
    })),
  )
}

async function assertActiveFacility(
  db: DbLike,
  facilityId: number | null | undefined,
): Promise<number | null> {
  if (facilityId === null || facilityId === undefined) {
    return null
  }

  const rows = await db
    .select({ id: healthcareFacilities.id, active: healthcareFacilities.active })
    .from(healthcareFacilities)
    .where(eq(healthcareFacilities.id, facilityId))
    .limit(1)

  const facility = rows?.[0]
  if (!facility?.id) {
    throw AppError.validation('Invalid facility', [
      {
        path: 'facilityId',
        message: 'Facility does not exist',
        code: 'invalid_facility',
      },
    ])
  }
  if (!facility.active) {
    throw AppError.validation('Facility is inactive', [
      {
        path: 'facilityId',
        message: 'Facility must be active for hospital staff accounts',
        code: 'inactive_facility',
      },
    ])
  }
  return facility.id
}

async function assertHospitalFacilityRequirement(
  db: DbLike,
  roleIds: number[],
  facilityId: number | null | undefined,
): Promise<void> {
  const roleNames = await roleNamesForIds(db, roleIds)
  const facilityRequiredRole = roleNames.find((name) =>
    ['Hospital Staff', 'Facility Manager'].includes(name),
  )
  if (facilityRequiredRole && !facilityId) {
    throw AppError.validation('Facility is required for this role', [
      {
        path: 'facilityId',
        message: `Facility is required when assigning ${facilityRequiredRole}`,
        code: 'hospital_facility_required',
      },
    ])
  }
}

async function replaceUserRoles(
  db: DbLike,
  userId: number,
  roleIds: number[],
): Promise<AdminRoleSummary[]> {
  const uniqueIds = [...new Set((roleIds ?? []).filter((id) => id > 0))]
  await assertRolesExist(db, uniqueIds)

  await db.delete(userRoles).where(eq(userRoles.userId, userId))

  if (uniqueIds.length > 0) {
    await db.insert(userRoles).values(
      uniqueIds.map((roleId) => ({
        userId,
        roleId,
      })),
    )
  }

  const roleMap = await loadRolesForUserIds(db, [userId])
  return roleMap.get(userId) ?? []
}

export async function listUsers(
  db: Db,
  query: ListUsersQuery = {},
  scope?: UserManagementScope,
): Promise<AdminUser[]> {
  if (scope && !canManageUsers(scope)) {
    throw AppError.forbidden('Insufficient permissions')
  }
  const conditions: SQL[] = []
  const facilityId = scopedFacilityId(scope)

  if (typeof facilityId === 'number') {
    conditions.push(eq(users.facilityId, facilityId))
  }

  if (query.status) {
    conditions.push(eq(users.status, query.status))
  }

  const q = query.q?.trim()
  if (q) {
    const pattern = `%${q}%`
    const search = or(like(users.name, pattern), like(users.email, pattern))
    if (search) {
      conditions.push(search)
    }
  }

  const whereClause =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions)

  const rows = await db
    .select(USER_SELECT)
    .from(users)
    .where(whereClause)
    .orderBy(asc(users.name), asc(users.id))

  const mapped = (rows ?? [])
    .map((row) => mapUserRow(row))
    .filter((row): row is UserRowWithoutHash => Boolean(row))

  const roleMap = await loadRolesForUserIds(
    db,
    mapped.map((row) => row.id),
  )

  return mapped
    .map((row) => toAdminUser(row, roleMap.get(row.id) ?? []))
    .filter((user): user is AdminUser => Boolean(user))
}

export async function getUserById(
  db: Db,
  userId: number,
  scope?: UserManagementScope,
): Promise<AdminUser | null> {
  if (scope && !canManageUsers(scope)) {
    throw AppError.forbidden('Insufficient permissions')
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    return null
  }

  const rows = await db
    .select(USER_SELECT)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const user = mapUserRow(rows?.[0])
  if (!user) {
    return null
  }
  assertFacilityScopedUserTarget(scope, user.facilityId)

  const roleMap = await loadRolesForUserIds(db, [user.id])
  return toAdminUser(user, roleMap.get(user.id) ?? [])
}

export async function createUser(
  db: Db,
  body: CreateUserBody,
  options: {
    assignRoles: boolean
    scope?: UserManagementScope
  } = { assignRoles: false },
): Promise<AdminUser> {
  if (options.scope && !canManageUsers(options.scope)) {
    throw AppError.forbidden('Insufficient permissions')
  }
  const email = body.email
  const passwordHash = await hashPassword(body.password)
  const status = body.status ?? 'ACTIVE'
  const roleIds = options.assignRoles ? (body.roleIds ?? []) : []
  const actorFacilityId = scopedFacilityId(options.scope)
  const requestedFacilityId =
    typeof actorFacilityId === 'number' ? actorFacilityId : body.facilityId
  const facilityId = await assertActiveFacility(db, requestedFacilityId)
  assertFacilityScopedUserTarget(options.scope, facilityId)

  if (roleIds.length > 0) {
    await assertRolesExist(db, roleIds)
    await assertHospitalFacilityRequirement(db, roleIds, facilityId)
    if (options.scope && !canManageRoles(options.scope)) {
      if (!canAssignFacilityRoles(options.scope)) {
        throw AppError.forbidden('roles:manage or roles:assign:facility is required to assign roles')
      }
      await assertFacilityAssignableRoles(db, roleIds)
    }
  }

  try {
    const created = await withTransaction(db, async (tx) => {
      await tx.insert(users).values({
        name: body.name,
        email,
        passwordHash,
        facilityId,
        status,
      })

      const inserted = await tx
        .select(USER_SELECT)
        .from(users)
        .where(eq(users.email, email))
        .limit(1)

      const user = mapUserRow(inserted?.[0])
      if (!user) {
        throw AppError.internal('Failed to load created user')
      }

      let assignedRoles: AdminRoleSummary[] = []
      if (roleIds.length > 0) {
        assignedRoles = await replaceUserRoles(tx, user.id, roleIds)
      }

      return toAdminUser(user, assignedRoles)
    })

    if (!created) {
      throw AppError.internal('Failed to create user')
    }
    return created
  } catch (error) {
    if (AppError.isAppError(error)) {
      throw error
    }
    if (isDuplicateEmailError(error)) {
      throw AppError.conflict('Email is already registered', [
        { path: 'email', message: 'Email is already registered' },
      ])
    }
    throw error
  }
}

export async function patchUser(
  db: Db,
  userId: number,
  body: PatchUserBody,
  scope?: UserManagementScope,
): Promise<AdminUser> {
  if (scope && !canManageUsers(scope)) {
    throw AppError.forbidden('Insufficient permissions')
  }
  const existing = await getUserById(db, userId, scope)
  if (!existing) {
    throw AppError.notFound('User not found')
  }

  const updates: {
    name?: string
    email?: string
    passwordHash?: string
    status?: UserStatus
    facilityId?: number | null
  } = {}

  if (body.name !== undefined) {
    updates.name = body.name
  }
  if (body.email !== undefined) {
    updates.email = body.email
  }
  if (body.status !== undefined) {
    updates.status = body.status
  }
  if (body.facilityId !== undefined) {
    const actorFacilityId = scopedFacilityId(scope)
    const requestedFacilityId =
      typeof actorFacilityId === 'number' ? actorFacilityId : body.facilityId
    updates.facilityId = await assertActiveFacility(db, requestedFacilityId)
    assertFacilityScopedUserTarget(scope, updates.facilityId)
    if (updates.facilityId === null) {
      const roleMap = await loadRolesForUserIds(db, [userId])
      const currentRoles = roleMap.get(userId) ?? []
      if (
        currentRoles.some((role) =>
          ['Hospital Staff', 'Facility Manager'].includes(role.name),
        )
      ) {
        throw AppError.validation('Facility is required for hospital staff', [
          {
            path: 'facilityId',
            message:
              'Remove facility-scoped roles before clearing the facility',
            code: 'hospital_facility_required',
          },
        ])
      }
    }
  }

  let revokeSessions = false
  if (body.password !== undefined) {
    updates.passwordHash = await hashPassword(body.password)
    revokeSessions = true
  }
  if (body.status === 'INACTIVE') {
    revokeSessions = true
  }

  if (Object.keys(updates).length === 0) {
    return existing
  }

  try {
    await db.update(users).set(updates).where(eq(users.id, userId))
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      throw AppError.conflict('Email is already registered', [
        { path: 'email', message: 'Email is already registered' },
      ])
    }
    throw error
  }

  if (revokeSessions) {
    await revokeAllUserSessions(db, userId)
  }

  const updated = await getUserById(db, userId, scope)
  if (!updated) {
    throw AppError.notFound('User not found')
  }
  return updated
}

/**
 * Soft-deactivate: set status=INACTIVE and revoke sessions (docs/06).
 * Does not hard-delete the row.
 */
export async function softDeactivateUser(
  db: Db,
  userId: number,
  scope?: UserManagementScope,
): Promise<AdminUser> {
  return patchUser(db, userId, { status: 'INACTIVE' }, scope)
}

export async function assignUserRoles(
  db: Db,
  userId: number,
  body: AssignUserRolesBody,
  scope?: UserManagementScope,
): Promise<AdminUser> {
  if (scope && !canManageRoles(scope) && !canAssignFacilityRoles(scope)) {
    throw AppError.forbidden('Insufficient permissions')
  }
  if (scope && !canManageRoles(scope) && !canManageUsers(scope)) {
    throw AppError.forbidden('Insufficient permissions')
  }
  const userScope = scope && canManageUsers(scope) ? scope : undefined
  const existing = await getUserById(db, userId, userScope)
  if (!existing) {
    throw AppError.notFound('User not found')
  }
  assertFacilityScopedUserTarget(userScope, existing.facilityId)

  await assertHospitalFacilityRequirement(
    db,
    body.roleIds ?? [],
    existing.facilityId,
  )
  if (scope && !canManageRoles(scope)) {
    await assertFacilityAssignableRoles(db, body.roleIds ?? [])
  }

  await withTransaction(db, async (tx) => {
    await replaceUserRoles(tx, userId, body.roleIds ?? [])
  })

  const updated = await getUserById(db, userId, userScope)
  if (!updated) {
    throw AppError.notFound('User not found')
  }
  return updated
}

export async function listRoles(
  db: Db,
  scope?: UserManagementScope,
): Promise<RoleListItem[]> {
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
    })
    .from(roles)
    .orderBy(asc(roles.name), asc(roles.id))

  const roleItems = (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    permissionCodes: [] as string[],
  }))
  const permissionMap = await permissionCodesForRoleIds(
    db,
    roleItems.map((role) => role.id),
  )

  if (scope && !canManageRoles(scope) && canAssignFacilityRoles(scope)) {
    const allowed = new Set<string>(FACILITY_ASSIGNABLE_PERMISSION_CODES)
    return roleItems.filter((role) => {
      if (!isFacilityAssignableRoleName(role.name)) {
        return false
      }
      const codes = permissionMap.get(role.id) ?? []
      return codes.every((code) => allowed.has(code))
    }).map((role) => ({
      ...role,
      permissionCodes: [...(permissionMap.get(role.id) ?? [])].sort(),
    }))
  }

  return roleItems.map((role) => ({
    ...role,
    permissionCodes: [...(permissionMap.get(role.id) ?? [])].sort(),
  }))
}

export async function getRoleById(
  db: Db,
  roleId: number,
): Promise<RoleListItem> {
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
    })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1)

  const row = rows?.[0]
  if (!row?.id) {
    throw AppError.notFound('Role not found')
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
  }
}

export async function getRoleWithPermissions(
  db: Db,
  roleId: number,
): Promise<RoleListItem> {
  const role = await getRoleById(db, roleId)
  const permissionMap = await permissionCodesForRoleIds(db, [role.id])
  return {
    ...role,
    permissionCodes: [...(permissionMap.get(role.id) ?? [])].sort(),
  }
}

export async function listPermissions(db: Db): Promise<PermissionListItem[]> {
  const rows = await db
    .select({
      id: permissions.id,
      code: permissions.code,
      description: permissions.description,
    })
    .from(permissions)
    .orderBy(asc(permissions.code), asc(permissions.id))

  return (rows ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    description: row.description ?? null,
  }))
}

async function assertUniqueRoleName(
  db: Db,
  name: string,
  excludeRoleId?: number,
): Promise<void> {
  const where =
    excludeRoleId !== undefined
      ? and(eq(roles.name, name), ne(roles.id, excludeRoleId))
      : eq(roles.name, name)

  const rows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(where)
    .limit(1)

  if (rows?.[0]?.id) {
    throw AppError.conflict('Role name already exists', [
      {
        path: 'name',
        message: 'Role name already exists',
        code: 'duplicate_role_name',
      },
    ])
  }
}

/**
 * Create a role row (name + optional description + optional permissions).
 */
export async function createRole(
  db: Db,
  body: CreateRoleBody,
): Promise<RoleListItem> {
  const name = body.name.trim()
  const description =
    body.description === undefined
      ? null
      : body.description === null
        ? null
        : body.description.trim() || null

  await assertUniqueRoleName(db, name)

  try {
    const created = await withTransaction(db, async (tx) => {
      const inserted = await tx
        .insert(roles)
        .values({
          name,
          description,
        })
        .$returningId()

      const insertId = inserted?.[0]?.id
      if (typeof insertId !== 'number' || !Number.isFinite(insertId)) {
        throw AppError.internal('Failed to create role')
      }

      if (body.permissionCodes !== undefined) {
        await replaceRolePermissions(tx, insertId, body.permissionCodes)
      }

      return insertId
    })

    return getRoleWithPermissions(db, created)
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      throw AppError.conflict('Role name already exists', [
        {
          path: 'name',
          message: 'Role name already exists',
          code: 'duplicate_role_name',
        },
      ])
    }
    throw error
  }
}

/**
 * Update role name, description, and/or permission mapping.
 */
export async function updateRole(
  db: Db,
  roleId: number,
  body: UpdateRoleBody,
): Promise<RoleListItem> {
  await getRoleById(db, roleId)

  const patch: { name?: string; description?: string | null } = {}

  if (body.name !== undefined) {
    const name = body.name.trim()
    await assertUniqueRoleName(db, name, roleId)
    patch.name = name
  }
  if (body.description !== undefined) {
    patch.description =
      body.description === null ? null : body.description.trim() || null
  }

  if (Object.keys(patch).length === 0 && body.permissionCodes === undefined) {
    throw AppError.validation('At least one field is required')
  }

  try {
    await withTransaction(db, async (tx) => {
      if (Object.keys(patch).length > 0) {
        await tx.update(roles).set(patch).where(eq(roles.id, roleId))
      }
      if (body.permissionCodes !== undefined) {
        await replaceRolePermissions(tx, roleId, body.permissionCodes)
      }
    })
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      throw AppError.conflict('Role name already exists', [
        {
          path: 'name',
          message: 'Role name already exists',
          code: 'duplicate_role_name',
        },
      ])
    }
    throw error
  }

  return getRoleWithPermissions(db, roleId)
}
