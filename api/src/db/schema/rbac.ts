import {
  index,
  int,
  mysqlTable,
  primaryKey,
  text,
  varchar,
} from 'drizzle-orm/mysql-core'

import { users } from './users'

/**
 * RBAC tables (docs/06, docs/10).
 * Access resolution: modules/auth/user-access; gates: middleware/require-permission.
 */
export const roles = mysqlTable('roles', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
})

export const permissions = mysqlTable('permissions', {
  id: int('id').autoincrement().primaryKey(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  description: text('description'),
})

export const userRoles = mysqlTable(
  'user_roles',
  {
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: int('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('user_roles_role_id_idx').on(table.roleId),
  ],
)

export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    roleId: int('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: int('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index('role_permissions_permission_id_idx').on(table.permissionId),
  ],
)
