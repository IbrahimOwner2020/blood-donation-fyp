import { AppError } from '../../lib/errors'
import type { AuthUser } from '../../lib/types'

export const HOSPITAL_STAFF_ROLE = 'Hospital Staff'
export const REGISTERED_DONOR_ROLE = 'Registered Donor'
export const FACILITY_MANAGER_ROLE = 'Facility Manager'

export const FACILITY_ASSIGNABLE_ROLE_DENYLIST = new Set([
  'System Administrator',
  'Facility Manager',
  'NBTS Blood Bank Officer',
  'Authorized Manager',
])

export const FACILITY_ASSIGNABLE_PERMISSION_CODES = [
  'facilities:read',
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
  'reports:read',
] as const

export function hasRole(
  roles: readonly string[] | null | undefined,
  roleName: string,
): boolean {
  return (roles ?? []).some((role) => role === roleName)
}

export function isHospitalStaff(
  roles: readonly string[] | null | undefined,
): boolean {
  return hasRole(roles, HOSPITAL_STAFF_ROLE)
}

export function isFacilityManager(
  roles: readonly string[] | null | undefined,
): boolean {
  return hasRole(roles, FACILITY_MANAGER_ROLE)
}

export function isFacilityAssignableRoleName(roleName: string): boolean {
  const name = roleName.trim()
  return Boolean(name) && !FACILITY_ASSIGNABLE_ROLE_DENYLIST.has(name)
}

export function requireHospitalFacilityId(
  user: AuthUser | null | undefined,
  roles: readonly string[] | null | undefined,
): number | undefined {
  if (!isHospitalStaff(roles)) {
    return undefined
  }

  const facilityId = user?.facilityId
  if (
    typeof facilityId !== 'number' ||
    !Number.isFinite(facilityId) ||
    facilityId <= 0
  ) {
    throw AppError.forbidden('Hospital staff account is not assigned to a facility')
  }

  return facilityId
}

export function requireAssignedFacilityId(
  user: AuthUser | null | undefined,
): number {
  const facilityId = user?.facilityId
  if (
    typeof facilityId !== 'number' ||
    !Number.isFinite(facilityId) ||
    facilityId <= 0
  ) {
    throw AppError.forbidden('Account is not assigned to a facility')
  }

  return facilityId
}
