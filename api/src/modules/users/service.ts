/**
 * Admin users / roles persistence (docs/04, docs/06, docs/10).
 * Soft-deactivate via status=INACTIVE; never returns passwordHash.
 */

import { and, asc, eq, inArray, like, ne, or, type SQL } from 'drizzle-orm'

import type { Db, DbTransaction } from '../../db'
import { withTransaction } from '../../db'
import { roles, userRoles, users } from '../../db/schema'
import type { UserStatus } from '../../db/schema/enums'
import { AppError } from '../../lib/errors'
import { hashPassword } from '../auth/password'
import { revokeAllUserSessions } from '../auth/sessions'
import type {
  AdminRoleSummary,
  AdminUser,
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

const USER_SELECT = {
  id: users.id,
  name: users.name,
  email: users.email,
  status: users.status,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const

function mapUserRow(
  row: {
    id: number
    name: string
    email: string
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
): Promise<AdminUser[]> {
  const conditions: SQL[] = []

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
): Promise<AdminUser | null> {
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

  const roleMap = await loadRolesForUserIds(db, [user.id])
  return toAdminUser(user, roleMap.get(user.id) ?? [])
}

export async function createUser(
  db: Db,
  body: CreateUserBody,
  options: { assignRoles: boolean } = { assignRoles: false },
): Promise<AdminUser> {
  const email = body.email
  const passwordHash = await hashPassword(body.password)
  const status = body.status ?? 'ACTIVE'
  const roleIds = options.assignRoles ? (body.roleIds ?? []) : []

  if (roleIds.length > 0) {
    await assertRolesExist(db, roleIds)
  }

  try {
    const created = await withTransaction(db, async (tx) => {
      await tx.insert(users).values({
        name: body.name,
        email,
        passwordHash,
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
): Promise<AdminUser> {
  const existing = await getUserById(db, userId)
  if (!existing) {
    throw AppError.notFound('User not found')
  }

  const updates: {
    name?: string
    email?: string
    passwordHash?: string
    status?: UserStatus
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

  const updated = await getUserById(db, userId)
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
): Promise<AdminUser> {
  return patchUser(db, userId, { status: 'INACTIVE' })
}

export async function assignUserRoles(
  db: Db,
  userId: number,
  body: AssignUserRolesBody,
): Promise<AdminUser> {
  const existing = await getUserById(db, userId)
  if (!existing) {
    throw AppError.notFound('User not found')
  }

  await withTransaction(db, async (tx) => {
    await replaceUserRoles(tx, userId, body.roleIds ?? [])
  })

  const updated = await getUserById(db, userId)
  if (!updated) {
    throw AppError.notFound('User not found')
  }
  return updated
}

export async function listRoles(db: Db): Promise<RoleListItem[]> {
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
    })
    .from(roles)
    .orderBy(asc(roles.name), asc(roles.id))

  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
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
 * Create a role row (name + optional description).
 * Permission mappings remain seed/admin tooling — docs/04 POST /roles.
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
    const inserted = await db
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

    return getRoleById(db, insertId)
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
 * Update role name and/or description (docs/04 PATCH /roles/:id).
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

  if (Object.keys(patch).length === 0) {
    throw AppError.validation('At least one field is required')
  }

  try {
    await db.update(roles).set(patch).where(eq(roles.id, roleId))
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

  return getRoleById(db, roleId)
}
