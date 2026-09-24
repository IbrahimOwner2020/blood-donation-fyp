/**
 * Canonical permission codes (docs/10-auth-security-and-rbac.md).
 * Data-oriented constants for seed + requirePermission middleware.
 */

export const PERMISSION_CODES = [
  'users:manage',
  'users:manage:facility',
  'roles:manage',
  'roles:assign:facility',
  'activity:read',
  'facilities:read',
  'facilities:create',
  'facilities:update',
  'donors:read',
  'donors:create',
  'donors:update',
  'donations:read',
  'donations:create',
  'inventory:read',
  'inventory:update',
  'requests:read',
  'requests:create',
  'requests:update',
  'predictions:read',
  'predictions:run',
  'alerts:read',
  'alerts:update',
  'notifications:read',
  'notifications:send',
  'reports:read',
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]

export const ROLE_NAMES = [
  'Administrator',
  'Blood Bank Staff',
  'Hospital Staff',
  'Registered Donor',
] as const

export type RoleName = (typeof ROLE_NAMES)[number]
