import { describe, expect, test } from 'bun:test'

import {
  FACILITY_ASSIGNABLE_PERMISSION_CODES,
  isFacilityAssignableRoleName,
} from '../../modules/auth/access-scope'
import { PERMISSION_CODES, ROLE_NAMES } from './permission-codes'
import { ROLE_PERMISSION_MAP } from './roles-permissions-data'

describe('seeded role and permission catalogue', () => {
  test('includes facility management permissions', () => {
    expect(PERMISSION_CODES).toContain('facilities:read')
    expect(PERMISSION_CODES).toContain('facilities:create')
    expect(PERMISSION_CODES).toContain('facilities:update')
    expect(PERMISSION_CODES).toContain('users:manage:facility')
    expect(PERMISSION_CODES).toContain('roles:assign:facility')
  })

  test('seeds the facility operations role catalogue', () => {
    expect(ROLE_NAMES).toContain('Facility Manager')
    expect(ROLE_NAMES).toContain('Donor Manager')
    expect(ROLE_NAMES).toContain('Blood Collector')
    expect(ROLE_NAMES).toContain('Blood Bank Manager')
    expect(ROLE_NAMES).toContain('Doctor')
  })

  test('facility manager can assign only roles without system-level powers', () => {
    const allowed = new Set<string>(FACILITY_ASSIGNABLE_PERMISSION_CODES)

    expect(isFacilityAssignableRoleName('System Administrator')).toBe(false)
    expect(isFacilityAssignableRoleName('Facility Manager')).toBe(false)

    for (const roleName of [
      'Donor Manager',
      'Blood Collector',
      'Blood Bank Manager',
      'Doctor',
      'Hospital Staff',
    ] as const) {
      expect(isFacilityAssignableRoleName(roleName)).toBe(true)
      const codes = ROLE_PERMISSION_MAP[roleName] ?? []
      expect(codes.every((code) => allowed.has(code))).toBe(true)
    }
  })
})
