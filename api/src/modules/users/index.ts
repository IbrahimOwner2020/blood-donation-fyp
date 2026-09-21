/**
 * Admin users / roles module (docs/04 Users and Roles).
 */

export {
  listUsersQuerySchema,
  userIdParamSchema,
  createUserBodySchema,
  patchUserBodySchema,
  assignUserRolesBodySchema,
  roleIdParamSchema,
  createRoleBodySchema,
  updateRoleBodySchema,
  type ListUsersQuery,
  type UserIdParam,
  type CreateUserBody,
  type PatchUserBody,
  type AssignUserRolesBody,
  type RoleIdParam,
  type CreateRoleBody,
  type UpdateRoleBody,
} from './schemas'
export {
  toAdminUser,
  type AdminUser,
  type AdminRoleSummary,
  type PermissionListItem,
  type RoleListItem,
  type UserRowWithoutHash,
} from './serialize'
export {
  listUsers,
  getUserById,
  createUser,
  patchUser,
  softDeactivateUser,
  assignUserRoles,
  listPermissions,
  listRoles,
  getRoleById,
  getRoleWithPermissions,
  createRole,
  updateRole,
  type UserManagementScope,
} from './service'
export { userRoutes, roleRoutes } from './routes'
