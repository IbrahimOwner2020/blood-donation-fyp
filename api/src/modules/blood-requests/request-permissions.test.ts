import { describe, expect, test } from 'bun:test'

import {
  assertBloodRequestStatusPermission,
  canMutateBloodRequestStatus,
  permissionForRequestStatus,
} from './request-permissions'

describe('blood request status permissions', () => {
  test('maps approve and cancel to requests:approve', () => {
    expect(permissionForRequestStatus('APPROVED')).toBe('requests:approve')
    expect(permissionForRequestStatus('CANCELLED')).toBe('requests:approve')
  })

  test('maps partial and fulfilled to requests:issue', () => {
    expect(permissionForRequestStatus('PARTIAL')).toBe('requests:issue')
    expect(permissionForRequestStatus('FULFILLED')).toBe('requests:issue')
  })

  test('allows approve permission for APPROVED and CANCELLED', () => {
    expect(() =>
      assertBloodRequestStatusPermission(['requests:approve'], 'APPROVED'),
    ).not.toThrow()
    expect(() =>
      assertBloodRequestStatusPermission(['requests:approve'], 'CANCELLED'),
    ).not.toThrow()
  })

  test('allows issue permission for PARTIAL and FULFILLED', () => {
    expect(() =>
      assertBloodRequestStatusPermission(['requests:issue'], 'PARTIAL'),
    ).not.toThrow()
    expect(() =>
      assertBloodRequestStatusPermission(['requests:issue'], 'FULFILLED'),
    ).not.toThrow()
  })

  test('rejects issue when only approve is granted', () => {
    expect(() =>
      assertBloodRequestStatusPermission(['requests:approve'], 'FULFILLED'),
    ).toThrow(/requests:issue/)
  })

  test('rejects approve when only issue is granted', () => {
    expect(() =>
      assertBloodRequestStatusPermission(['requests:issue'], 'APPROVED'),
    ).toThrow(/requests:approve/)
  })

  test('detects either mutation permission', () => {
    expect(canMutateBloodRequestStatus(['requests:approve'])).toBe(true)
    expect(canMutateBloodRequestStatus(['requests:issue'])).toBe(true)
    expect(canMutateBloodRequestStatus(['requests:read'])).toBe(false)
  })
})
