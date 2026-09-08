import {
  PERMISSION_CODES,
  ROLE_NAMES,
  type PermissionCode,
  type RoleName,
} from './permission-codes'

export interface RoleSeed {
  name: RoleName
  description: string
}

export interface PermissionSeed {
  code: PermissionCode
  description: string
}

/** Stable role definitions (docs/10). */
export const ROLE_SEEDS: readonly RoleSeed[] = [
  {
    name: 'System Administrator',
    description:
      'Super admin with every permission: users, roles, operations, forecasts, alerts, reports, and activity.',
  },
  {
    name: 'NBTS Blood Bank Officer',
    description:
      'Operate donors, donations, inventory, blood requests, shortage alerts, and notifications.',
  },
  {
    name: 'Authorized Manager',
    description:
      'Access dashboards, forecasts, shortage alerts, reports, and notification monitoring.',
  },
] as const

const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  'users:manage': 'Create, update, and deactivate user accounts.',
  'roles:manage': 'Assign roles and manage role–permission mappings.',
  'activity:read': 'View activity / audit logs.',
  'donors:read': 'View donor records.',
  'donors:create': 'Register new donors.',
  'donors:update': 'Update donor records and soft-deactivate.',
  'donations:read': 'View donation records.',
  'donations:create': 'Record new donations.',
  'inventory:read': 'View blood inventory and summaries.',
  'inventory:update': 'Update inventory status and assignments.',
  'requests:read': 'View blood requests.',
  'requests:create': 'Create blood requests.',
  'requests:update': 'Update blood request status and fulfilment.',
  'predictions:read': 'View AI forecasts and prediction history.',
  'predictions:run': 'Trigger forecast runs.',
  'alerts:read': 'View shortage alerts.',
  'alerts:update': 'Acknowledge, resolve, or dismiss shortage alerts.',
  'notifications:read': 'View notification history and previews.',
  'notifications:send': 'Send donor notifications.',
  'reports:read': 'View operational and analytical reports.',
}

/** All permission rows to seed — codes match docs/10 examples. */
export const PERMISSION_SEEDS: readonly PermissionSeed[] =
  PERMISSION_CODES.map((code) => ({
    code,
    description: PERMISSION_DESCRIPTIONS[code] ?? code,
  }))

/**
 * Role → permission mapping (docs/10 role capabilities).
 * System Administrator: every code in PERMISSION_CODES (super admin).
 * Officer: operational CRUD for donors through notifications.
 * Manager: dashboards/forecasts/alerts/reports + read monitoring.
 */
export const ROLE_PERMISSION_MAP: Readonly<
  Record<RoleName, readonly PermissionCode[]>
> = {
  'System Administrator': PERMISSION_CODES,
  'NBTS Blood Bank Officer': [
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
    'alerts:read',
    'alerts:update',
    'notifications:read',
    'notifications:send',
  ],
  'Authorized Manager': [
    'donors:read',
    'donations:read',
    'inventory:read',
    'requests:read',
    'predictions:read',
    'predictions:run',
    'alerts:read',
    'alerts:update',
    'notifications:read',
    'reports:read',
  ],
}

/** Flattened (roleName, permissionCode) pairs for seeding. */
export function listRolePermissionPairs(): ReadonlyArray<{
  roleName: RoleName
  permissionCode: PermissionCode
}> {
  const pairs: Array<{
    roleName: RoleName
    permissionCode: PermissionCode
  }> = []

  for (const roleName of ROLE_NAMES) {
    const codes = ROLE_PERMISSION_MAP[roleName] ?? []
    for (const permissionCode of codes) {
      pairs.push({ roleName, permissionCode })
    }
  }

  return pairs
}
