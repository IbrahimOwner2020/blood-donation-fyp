import { describe, expect, test } from 'bun:test'

import { PERMISSION_CODES } from '../../lib/permissions'
import {
  filterKnownPermissionCodes,
  hasAllPermissions,
  hasAnyPermission,
} from './user-access'

describe('hasAllPermissions', () => {
  test('returns true when every required code is granted', () => {
    expect(
      hasAllPermissions(
        ['donors:read', 'donors:create', 'inventory:read'],
        ['donors:read', 'inventory:read'],
      ),
    ).toBe(true)
  })

  test('returns false when any required code is missing', () => {
    expect(
      hasAllPermissions(['donors:read'], ['donors:read', 'donors:update']),
    ).toBe(false)
  })

  test('returns true for empty required list', () => {
    expect(hasAllPermissions(['donors:read'], [])).toBe(true)
  })

  test('treats null/undefined granted as empty', () => {
    expect(hasAllPermissions(null, ['donors:read'])).toBe(false)
    expect(hasAllPermissions(undefined, ['donors:read'])).toBe(false)
  })

  test('ignores blank required codes after trim', () => {
    expect(hasAllPermissions(['donors:read'], ['  donors:read  '])).toBe(true)
  })
})

describe('hasAnyPermission', () => {
  test('returns true when at least one candidate matches', () => {
    expect(
      hasAnyPermission(['inventory:read'], ['users:manage', 'inventory:read']),
    ).toBe(true)
  })

  test('returns false when none match or candidates empty', () => {
    expect(hasAnyPermission(['inventory:read'], ['users:manage'])).toBe(false)
    expect(hasAnyPermission(['inventory:read'], [])).toBe(false)
  })
})

describe('filterKnownPermissionCodes', () => {
  test('keeps only canonical codes', () => {
    expect(
      filterKnownPermissionCodes(
        ['donors:read', 'not:a:real:code', 'inventory:update'],
        PERMISSION_CODES,
      ),
    ).toEqual(['donors:read', 'inventory:update'])
  })

  test('returns empty for nullish input', () => {
    expect(filterKnownPermissionCodes(null, PERMISSION_CODES)).toEqual([])
    expect(filterKnownPermissionCodes(undefined, PERMISSION_CODES)).toEqual([])
  })
})
