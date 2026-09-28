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
    name: 'Administrator',
    description:
      'Manages users, fixed role assignment, facilities, operational records, reports, notifications, audit logs, and configuration.',
  },
  {
    name: 'Manager',
    description:
      'Approves or cancels blood requests nationally, and monitors donors, donations, inventory, alerts, notifications, and reports (read-only).',
  },
  {
    name: 'Blood Bank Staff',
    description:
      'Manages donors, donations, and inventory, and issues units against manager-approved blood requests.',
  },
  {
    name: 'Hospital Staff',
    description:
      'Creates blood requests for their assigned facility and reads own-facility inventory and reports.',
  },
] as const

const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  'users:manage': 'Create, update, and deactivate user accounts.',
  'users:manage:facility':
    "Create, update, and deactivate user accounts only within the actor's assigned facility.",
  'roles:manage': 'Assign roles and manage role–permission mappings.',
  'roles:assign:facility':
    "Assign facility-safe roles to users in the actor's assigned facility.",
  'activity:read': 'View activity / audit logs.',
  'facilities:read': 'View healthcare facilities.',
  'facilities:create': 'Create healthcare facilities.',
  'facilities:update': 'Update healthcare facilities and soft-deactivate.',
  'donors:read': 'View donor records.',
  'donors:create': 'Register new donors.',
  'donors:update': 'Update donor records and soft-deactivate.',
  'donations:read': 'View donation records.',
  'donations:create': 'Record new donations.',
  'inventory:read': 'View blood inventory and summaries.',
  'inventory:update': 'Update inventory status and assignments.',
  'requests:read': 'View blood requests.',
  'requests:create': 'Create blood requests.',
  'requests:approve':
    'Approve pending blood requests or cancel open requests.',
  'requests:issue':
    'Issue units against approved blood requests (partial or full fulfilment).',
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
 * Administrator: every code in PERMISSION_CODES.
 * Manager: national approve/cancel + read monitoring (alerts).
 * Blood Bank Staff: operational CRUD; issue approved requests only.
 * Hospital Staff: create own-facility requests; read inventory/reports.
 */
export const ROLE_PERMISSION_MAP: Readonly<
  Record<RoleName, readonly PermissionCode[]>
> = {
  Administrator: PERMISSION_CODES,
  Manager: [
    'facilities:read',
    'donors:read',
    'donations:read',
    'inventory:read',
    'requests:read',
    'requests:approve',
    'alerts:read',
    'notifications:read',
    'reports:read',
  ],
  'Blood Bank Staff': [
    'facilities:read',
    'donors:read',
    'donors:create',
    'donors:update',
    'donations:read',
    'donations:create',
    'inventory:read',
    'inventory:update',
    'requests:read',
    'requests:issue',
    'notifications:read',
    'notifications:send',
    'reports:read',
  ],
  'Hospital Staff': [
    'facilities:read',
    'inventory:read',
    'requests:read',
    'requests:create',
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
