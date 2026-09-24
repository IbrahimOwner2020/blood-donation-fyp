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

  test('seeds exactly the fixed four-role catalogue', () => {
    expect([...ROLE_NAMES]).toEqual([
      'Administrator',
      'Blood Bank Staff',
      'Hospital Staff',
      'Registered Donor',
    ])
  })

  test('facility manager can assign only roles without system-level powers', () => {
    const allowed = new Set<string>(FACILITY_ASSIGNABLE_PERMISSION_CODES)

    expect(isFacilityAssignableRoleName('Administrator')).toBe(false)
    expect(isFacilityAssignableRoleName('Blood Bank Staff')).toBe(false)

    for (const roleName of [
      'Hospital Staff',
      'Registered Donor',
    ] as const) {
      expect(isFacilityAssignableRoleName(roleName)).toBe(true)
      const codes = ROLE_PERMISSION_MAP[roleName] ?? []
      expect(codes.every((code) => allowed.has(code))).toBe(true)
    }
  })
})
