/**
 * Resolve a user's RBAC roles and permission codes from the database.
 * Used by requirePermission / attachUserAccess (docs/10).
 */

import { eq } from 'drizzle-orm'

import type { Db } from '../../db'
import { permissions, rolePermissions, roles, userRoles } from '../../db/schema'
import type { PermissionCode } from '../../lib/permissions'

export type UserAccess = {
  /** Distinct role names assigned to the user. */
  roles: string[]
  /** Distinct permission codes granted via those roles. */
  permissions: string[]
}

export type ResolveUserAccess = (userId: number) => Promise<UserAccess>

const EMPTY_ACCESS: UserAccess = {
  roles: [],
  permissions: [],
}

/**
 * Load roles and permission codes for a user via user_roles → roles / role_permissions.
 * Returns empty arrays when the user has no assignments (never throws for missing rows).
 */
export async function loadUserAccess(
  db: Db,
  userId: number | null | undefined,
): Promise<UserAccess> {
  if (typeof userId !== 'number' || !Number.isFinite(userId) || userId <= 0) {
    return { ...EMPTY_ACCESS }
  }

  const roleRows = await db
    .select({ name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId))

  const permissionRows = await db
    .select({ code: permissions.code })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(userRoles.userId, userId))

  const roleNames = [
    ...new Set(
      (roleRows ?? [])
        .map((row) => row?.name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort()

  const permissionCodes = [
    ...new Set(
      (permissionRows ?? [])
        .map((row) => row?.code?.trim())
        .filter((code): code is string => Boolean(code)),
    ),
  ].sort()

  return {
    roles: roleNames,
    permissions: permissionCodes,
  }
}

/** True when every required code is present in the granted set. */
export function hasAllPermissions(
  granted: readonly string[] | null | undefined,
  required: readonly string[],
): boolean {
  if (!required?.length) {
    return true
  }
  const set = new Set((granted ?? []).filter(Boolean))
  return required.every((code) => {
    const normalized = code?.trim()
    return Boolean(normalized) && set.has(normalized)
  })
}

/** True when at least one of the codes is present. */
export function hasAnyPermission(
  granted: readonly string[] | null | undefined,
  candidates: readonly string[],
): boolean {
  if (!candidates?.length) {
    return false
  }
  const set = new Set((granted ?? []).filter(Boolean))
  return candidates.some((code) => {
    const normalized = code?.trim()
    return Boolean(normalized) && set.has(normalized)
  })
}

/** Narrow a string list to known PermissionCode values (unknown codes dropped). */
export function filterKnownPermissionCodes(
  codes: readonly string[] | null | undefined,
  known: readonly PermissionCode[],
): PermissionCode[] {
  const knownSet = new Set<string>(known)
  return (codes ?? []).filter((code): code is PermissionCode =>
    Boolean(code) && knownSet.has(code),
  )
}
