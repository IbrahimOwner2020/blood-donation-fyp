/**
 * Admin user / role DTOs — never includes passwordHash.
 */

import type { UserStatus } from '../../db/schema/enums'
import type { PublicUser } from '../auth/serialize'

export type AdminRoleSummary = {
  id: number
  name: string
}

export type AdminUser = PublicUser & {
  roles: AdminRoleSummary[]
}

export type RoleListItem = {
  id: number
  name: string
  description: string | null
  permissionCodes?: string[]
}

export type PermissionListItem = {
  id: number
  code: string
  description: string | null
}

export type UserRowWithoutHash = {
  id: number
  name: string
  email: string
  facilityId: number | null
  status: UserStatus
  createdAt: Date
  updatedAt: Date
}

/** Build an admin user DTO from a safe row + role summaries. */
export function toAdminUser(
  user: UserRowWithoutHash | null | undefined,
  roles: AdminRoleSummary[] = [],
): AdminUser | null {
  if (!user) {
    return null
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    facilityId: user.facilityId ?? null,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    roles: roles ?? [],
  }
}
