import { inArray } from 'drizzle-orm'

import type { Db } from '../client'
import { permissions, rolePermissions, roles } from '../schema'
import {
  listRolePermissionPairs,
  PERMISSION_SEEDS,
  ROLE_SEEDS,
} from './roles-permissions-data'

export interface SeedRolesPermissionsResult {
  rolesInserted: number
  rolesSkipped: number
  permissionsInserted: number
  permissionsSkipped: number
  mappingsInserted: number
  mappingsSkipped: number
  roleNames: string[]
  permissionCodes: string[]
}

function mappingKey(roleId: number, permissionId: number): string {
  return `${roleId}:${permissionId}`
}

/**
 * Idempotent seed of roles, permissions, and role_permissions (docs/10).
 * Inserts only missing rows by unique name/code and composite PK.
 */
export async function seedRolesPermissions(
  db: Db,
): Promise<SeedRolesPermissionsResult> {
  const roleNames = ROLE_SEEDS.map((row) => row.name)
  const permissionCodes = PERMISSION_SEEDS.map((row) => row.code)

  const existingRoles = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(inArray(roles.name, [...roleNames]))

  const existingRoleNames = new Set(
    (existingRoles ?? [])
      .map((row) => row?.name)
      .filter((name): name is string => Boolean(name)),
  )

  const rolesToInsert = ROLE_SEEDS.filter(
    (row) => !existingRoleNames.has(row.name),
  )

  if (rolesToInsert.length > 0) {
    await db.insert(roles).values([...rolesToInsert])
  }

  const existingPermissions = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, [...permissionCodes]))

  const existingPermissionCodes = new Set(
    (existingPermissions ?? [])
      .map((row) => row?.code)
      .filter((code): code is string => Boolean(code)),
  )

  const permissionsToInsert = PERMISSION_SEEDS.filter(
    (row) => !existingPermissionCodes.has(row.code),
  )

  if (permissionsToInsert.length > 0) {
    await db.insert(permissions).values([...permissionsToInsert])
  }

  const allRoles = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(inArray(roles.name, [...roleNames]))

  const allPermissions = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, [...permissionCodes]))

  const roleIdByName = new Map<string, number>()
  for (const row of allRoles ?? []) {
    if (row?.name != null && row?.id != null) {
      roleIdByName.set(row.name, row.id)
    }
  }

  const permissionIdByCode = new Map<string, number>()
  for (const row of allPermissions ?? []) {
    if (row?.code != null && row?.id != null) {
      permissionIdByCode.set(row.code, row.id)
    }
  }

  const roleIds = [...roleIdByName.values()]
  const existingMappings =
    roleIds.length > 0
      ? await db
          .select({
            roleId: rolePermissions.roleId,
            permissionId: rolePermissions.permissionId,
          })
          .from(rolePermissions)
          .where(inArray(rolePermissions.roleId, roleIds))
      : []

  const existingMappingKeys = new Set(
    (existingMappings ?? [])
      .filter(
        (row): row is { roleId: number; permissionId: number } =>
          row?.roleId != null && row?.permissionId != null,
      )
      .map((row) => mappingKey(row.roleId, row.permissionId)),
  )

  const pairs = listRolePermissionPairs()
  const mappingsToInsert: Array<{ roleId: number; permissionId: number }> = []
  let mappingsSkipped = 0

  for (const pair of pairs) {
    const roleId = roleIdByName.get(pair.roleName)
    const permissionId = permissionIdByCode.get(pair.permissionCode)

    if (roleId == null || permissionId == null) {
      continue
    }

    const key = mappingKey(roleId, permissionId)
    if (existingMappingKeys.has(key)) {
      mappingsSkipped += 1
      continue
    }

    mappingsToInsert.push({ roleId, permissionId })
    existingMappingKeys.add(key)
  }

  if (mappingsToInsert.length > 0) {
    await db.insert(rolePermissions).values(mappingsToInsert)
  }

  return {
    rolesInserted: rolesToInsert.length,
    rolesSkipped: ROLE_SEEDS.length - rolesToInsert.length,
    permissionsInserted: permissionsToInsert.length,
    permissionsSkipped: PERMISSION_SEEDS.length - permissionsToInsert.length,
    mappingsInserted: mappingsToInsert.length,
    mappingsSkipped,
    roleNames: [...roleNames],
    permissionCodes: [...permissionCodes],
  }
}