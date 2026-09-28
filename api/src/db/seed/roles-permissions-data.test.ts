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

  test('splits request approve and issue permissions', () => {
    expect(PERMISSION_CODES).toContain('requests:approve')
    expect(PERMISSION_CODES).toContain('requests:issue')
    expect(PERMISSION_CODES).not.toContain('requests:update')
  })

  test('seeds the fixed four-role catalogue', () => {
    expect([...ROLE_NAMES]).toEqual([
      'Administrator',
      'Manager',
      'Blood Bank Staff',
      'Hospital Staff',
    ])
  })

  test('Manager can approve but not issue or mutate inventory', () => {
    const codes = ROLE_PERMISSION_MAP.Manager ?? []
    expect(codes).toContain('requests:approve')
    expect(codes).toContain('alerts:read')
    expect(codes).not.toContain('requests:issue')
    expect(codes).not.toContain('inventory:update')
    expect(codes).not.toContain('donors:create')
  })

  test('Blood Bank Staff can issue but not approve or create requests', () => {
    const codes = ROLE_PERMISSION_MAP['Blood Bank Staff'] ?? []
    expect(codes).toContain('requests:issue')
    expect(codes).toContain('inventory:update')
    expect(codes).not.toContain('requests:approve')
    expect(codes).not.toContain('requests:create')
  })

  test('Hospital Staff can create own-facility requests only', () => {
    const codes = ROLE_PERMISSION_MAP['Hospital Staff'] ?? []
    expect(codes).toContain('requests:create')
    expect(codes).toContain('requests:read')
    expect(codes).not.toContain('requests:approve')
    expect(codes).not.toContain('requests:issue')
    expect(codes).not.toContain('inventory:update')
  })

  test('facility manager can assign only roles without system-level powers', () => {
    const allowed = new Set<string>(FACILITY_ASSIGNABLE_PERMISSION_CODES)

    expect(isFacilityAssignableRoleName('Administrator')).toBe(false)
    expect(isFacilityAssignableRoleName('Manager')).toBe(false)
    expect(isFacilityAssignableRoleName('Blood Bank Staff')).toBe(false)
    expect(isFacilityAssignableRoleName('Registered Donor')).toBe(false)

    expect(isFacilityAssignableRoleName('Hospital Staff')).toBe(true)
    const codes = ROLE_PERMISSION_MAP['Hospital Staff'] ?? []
    expect(codes.every((code) => allowed.has(code))).toBe(true)
  })
})
