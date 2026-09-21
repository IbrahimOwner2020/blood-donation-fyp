/**
 * Admin users + roles routes (docs/04 Users and Roles, docs/10).
 * Mounted under /api/v1/users and /api/v1/roles.
 */

import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import { Hono } from 'hono'

import { getDb } from '../../db'
import { AppError } from '../../lib/errors'
import type { PermissionCode } from '../../lib/permissions'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import {
  attachUserAccess,
  requirePermission,
} from '../../middleware/require-permission'
import {
  hasAnyPermission,
  loadUserAccess,
} from '../auth/user-access'
import {
  RoleAuditActions,
  UserAuditActions,
  recordActivity,
  type UserAuditAction,
} from '../../services/audit'
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
import {
  assignUserRoles,
  createRole,
  createUser,
  getRoleWithPermissions,
  getUserById,
  listPermissions,
  listRoles,
  listUsers,
  patchUser,
  softDeactivateUser,
  type UserManagementScope,
  updateRole,
} from './service'

function clientIp(c: Context<AppHonoEnv>): string | null {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    return first || null
  }
  return c.req.header('x-real-ip')?.trim() || null
}

/** Require at least one of the listed permissions (OR). */
function requireAnyPermission(
  ...codes: [PermissionCode, ...PermissionCode[]]
) {
  return createMiddleware<AppHonoEnv>(async (c, next) => {
    const user = c.get('user')
    if (!user?.id) {
      throw AppError.unauthorized('Authentication required')
    }

    let granted = c.get('permissions')
    let roleNames = c.get('roles')

    if (!Array.isArray(granted) || !Array.isArray(roleNames)) {
      const access = await loadUserAccess(getDb(), user.id)
      roleNames = access?.roles ?? []
      granted = access?.permissions ?? []
      c.set('roles', roleNames)
      c.set('permissions', granted)
    }

    if (!hasAnyPermission(granted, codes)) {
      throw AppError.forbidden('Insufficient permissions')
    }

    await next()
  })
}

async function auditUserChange(
  c: Context<AppHonoEnv>,
  action: UserAuditAction,
  entityId: number,
  metadata: Record<string, string | number | boolean | null | undefined> = {},
): Promise<void> {
  await recordActivity({
    actorUserId: c.get('user')?.id ?? null,
    action,
    entityType: 'user',
    entityId,
    metadata,
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })
}

function userManagementScope(c: Context<AppHonoEnv>): UserManagementScope {
  return {
    actor: c.get('user'),
    permissions: c.get('permissions') ?? [],
  }
}

export const userRoutes = new Hono<AppHonoEnv>()

userRoutes.use('*', requireAuth, attachUserAccess())

/**
 * GET /users
 * List users (optional status / q). Global admins see all; facility managers
 * see only their assigned facility.
 */
userRoutes.get(
  '/',
  requireAnyPermission('users:manage', 'users:manage:facility'),
  async (c) => {
    const query = parseQuery(c, listUsersQuerySchema)
    const usersList = await listUsers(getDb(), query, userManagementScope(c))
    return jsonOk(c, { users: usersList })
  },
)

/**
 * POST /users
 * Create user; optional roleIds requires roles:manage or scoped assignment.
 */
userRoutes.post(
  '/',
  requireAnyPermission('users:manage', 'users:manage:facility'),
  async (c) => {
    const body = await parseJsonBody(c, createUserBodySchema)
    const permissions = c.get('permissions') ?? []
    const wantsRoles = Array.isArray(body.roleIds) && body.roleIds.length > 0
    const canAssignRoles = hasAnyPermission(permissions, [
      'roles:manage',
      'roles:assign:facility',
    ])

    if (wantsRoles && !canAssignRoles) {
      throw AppError.forbidden(
        'roles:manage or roles:assign:facility is required to assign roles on user create',
      )
    }

    const user = await createUser(getDb(), body, {
      assignRoles: wantsRoles && canAssignRoles,
      scope: userManagementScope(c),
    })

    await auditUserChange(c, UserAuditActions.USER_CREATE, user.id, {
      status: user.status,
      roleCount: user.roles?.length ?? 0,
    })

    return jsonOk(c, { user }, 201)
  },
)

/**
 * GET /users/:id
 */
userRoutes.get(
  '/:id',
  requireAnyPermission('users:manage', 'users:manage:facility'),
  async (c) => {
    const { id } = parseParams(c, userIdParamSchema)
    const user = await getUserById(getDb(), id, userManagementScope(c))
    if (!user) {
      throw AppError.notFound('User not found')
    }
    return jsonOk(c, { user })
  },
)

/**
 * PATCH /users/:id
 * Update profile fields / password / status (soft-deactivate via INACTIVE).
 */
userRoutes.patch(
  '/:id',
  requireAnyPermission('users:manage', 'users:manage:facility'),
  async (c) => {
    const { id } = parseParams(c, userIdParamSchema)
    const body = await parseJsonBody(c, patchUserBodySchema)
    const user = await patchUser(getDb(), id, body, userManagementScope(c))

    const action =
      body.status === 'INACTIVE'
        ? UserAuditActions.USER_DEACTIVATE
        : UserAuditActions.USER_UPDATE

    await auditUserChange(c, action, user.id, {
      updatedFields: Object.keys(body).join(','),
      status: user.status,
    })

    return jsonOk(c, { user })
  },
)

/**
 * DELETE /users/:id
 * Soft-deactivate (status=INACTIVE); does not hard-delete.
 */
userRoutes.delete(
  '/:id',
  requireAnyPermission('users:manage', 'users:manage:facility'),
  async (c) => {
    const { id } = parseParams(c, userIdParamSchema)
    const user = await softDeactivateUser(getDb(), id, userManagementScope(c))

    await auditUserChange(c, UserAuditActions.USER_DEACTIVATE, user.id, {
      softDelete: true,
      status: user.status,
    })

    return jsonOk(c, { user })
  },
)

/**
 * PUT /users/:id/roles
 * Replace role assignments. Global admins need roles:manage; facility managers
 * need roles:assign:facility and are limited to facility-safe roles.
 */
userRoutes.put(
  '/:id/roles',
  requireAnyPermission('roles:manage', 'roles:assign:facility'),
  async (c) => {
    const { id } = parseParams(c, userIdParamSchema)
    const body = await parseJsonBody(c, assignUserRolesBodySchema)
    const user = await assignUserRoles(getDb(), id, body, userManagementScope(c))

    await auditUserChange(c, UserAuditActions.USER_ROLES_ASSIGN, user.id, {
      roleIds: (body.roleIds ?? []).join(','),
      roleCount: user.roles?.length ?? 0,
    })

    return jsonOk(c, { user })
  },
)

/**
 * GET /roles
 * List roles for admin assignment UIs.
 * Allowed with global/scoped user management or role management permissions.
 */
export const roleRoutes = new Hono<AppHonoEnv>()

roleRoutes.use('*', requireAuth, attachUserAccess())

roleRoutes.get(
  '/',
  requireAnyPermission(
    'users:manage',
    'users:manage:facility',
    'roles:manage',
    'roles:assign:facility',
  ),
  async (c) => {
    const rolesList = await listRoles(getDb(), userManagementScope(c))
    return jsonOk(c, { roles: rolesList })
  },
)

roleRoutes.get(
  '/permissions',
  requirePermission('roles:manage'),
  async (c) => {
    const permissionsList = await listPermissions(getDb())
    return jsonOk(c, { permissions: permissionsList })
  },
)

roleRoutes.get('/:id', requirePermission('roles:manage'), async (c) => {
  const { id } = parseParams(c, roleIdParamSchema)
  const role = await getRoleWithPermissions(getDb(), id)
  return jsonOk(c, { role })
})

/**
 * POST /roles
 * Create role (name + description). Requires roles:manage.
 */
roleRoutes.post('/', requirePermission('roles:manage'), async (c) => {
  const body = await parseJsonBody(c, createRoleBodySchema)
  const role = await createRole(getDb(), body)

  await recordActivity({
    actorUserId: c.get('user')?.id ?? null,
    action: RoleAuditActions.CREATE,
    entityType: 'role',
    entityId: role.id,
    metadata: {
      name: role.name,
      description: role.description,
    },
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })

  return jsonOk(c, { role }, 201)
})

/**
 * PATCH /roles/:id
 * Update role name/description. Requires roles:manage.
 */
roleRoutes.patch('/:id', requirePermission('roles:manage'), async (c) => {
  const { id } = parseParams(c, roleIdParamSchema)
  const body = await parseJsonBody(c, updateRoleBodySchema)
  const role = await updateRole(getDb(), id, body)

  await recordActivity({
    actorUserId: c.get('user')?.id ?? null,
    action: RoleAuditActions.UPDATE,
    entityType: 'role',
    entityId: role.id,
    metadata: {
      name: role.name,
      description: role.description,
      fieldsUpdated: Object.keys(body ?? {}).join(','),
    },
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })

  return jsonOk(c, { role })
})
