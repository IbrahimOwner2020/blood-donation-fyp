/**
 * RBAC middleware: attach roles/permissions and gate routes by permission code (docs/10).
 * Session validation stays in requireAuth; this layer only resolves / checks access.
 */

import { createMiddleware } from 'hono/factory'

import { getDb } from '../db'
import { AppError } from '../lib/errors'
import type { PermissionCode } from '../lib/permissions'
import type { AppHonoEnv } from '../lib/types'
import {
  hasAllPermissions,
  loadUserAccess,
  type ResolveUserAccess,
  type UserAccess,
} from '../modules/auth/user-access'

export type RequirePermissionOptions = {
  /**
   * Injected resolver for unit tests. Production uses Drizzle via getDb().
   */
  loadAccess?: ResolveUserAccess
}

function defaultLoadAccess(userId: number): Promise<UserAccess> {
  return loadUserAccess(getDb(), userId)
}

/**
 * Ensure roles/permissions are on the context for an already-authenticated user.
 * Safe to stack after requireAuth; skips DB if already loaded.
 */
export function attachUserAccess(options: RequirePermissionOptions = {}) {
  const loadAccess = options.loadAccess ?? defaultLoadAccess

  return createMiddleware<AppHonoEnv>(async (c, next) => {
    const user = c.get('user')
    if (!user?.id) {
      throw AppError.unauthorized('Authentication required')
    }

    const existingRoles = c.get('roles')
    const existingPermissions = c.get('permissions')
    if (Array.isArray(existingRoles) && Array.isArray(existingPermissions)) {
      await next()
      return
    }

    const access = await loadAccess(user.id)
    c.set('roles', access?.roles ?? [])
    c.set('permissions', access?.permissions ?? [])
    await next()
  })
}

/**
 * Require every listed permission code (AND semantics).
 * Loads RBAC onto context when missing. Expects requireAuth upstream (or user set).
 *
 * @example
 * app.patch('/inventory/:id', requireAuth, requirePermission('inventory:update'), handler)
 */
export function requirePermission(
  ...codes: [PermissionCode | string, ...(PermissionCode | string)[]]
) {
  return createRequirePermission(codes)
}

/**
 * Factory with injectable access loader — prefer this in unit tests.
 */
export function createRequirePermission(
  codes: readonly (PermissionCode | string)[],
  options: RequirePermissionOptions = {},
) {
  const required = (codes ?? [])
    .map((code) => (typeof code === 'string' ? code.trim() : ''))
    .filter(Boolean)

  if (required.length === 0) {
    throw new Error('requirePermission requires at least one permission code')
  }

  const loadAccess = options.loadAccess ?? defaultLoadAccess

  return createMiddleware<AppHonoEnv>(async (c, next) => {
    const user = c.get('user')
    if (!user?.id) {
      throw AppError.unauthorized('Authentication required')
    }

    let granted = c.get('permissions')
    let roleNames = c.get('roles')

    if (!Array.isArray(granted) || !Array.isArray(roleNames)) {
      const access = await loadAccess(user.id)
      roleNames = access?.roles ?? []
      granted = access?.permissions ?? []
      c.set('roles', roleNames)
      c.set('permissions', granted)
    }

    if (!hasAllPermissions(granted, required)) {
      throw AppError.forbidden('Insufficient permissions')
    }

    await next()
  })
}
