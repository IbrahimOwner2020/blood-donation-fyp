/**
 * Unit tests for admin user serialization (never expose passwordHash).
 */

import { describe, expect, test } from 'bun:test'

import { toAdminUser } from './serialize'

describe('toAdminUser', () => {
  test('returns null for missing user and never includes passwordHash', () => {
    expect(toAdminUser(null)).toBeNull()

    const dto = toAdminUser(
      {
        id: 1,
        name: 'Ada',
        email: 'ada@example.com',
        facilityId: null,
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      [{ id: 2, name: 'System Administrator' }],
    )

    expect(dto).toEqual({
      id: 1,
      name: 'Ada',
      email: 'ada@example.com',
      facilityId: null,
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      roles: [{ id: 2, name: 'System Administrator' }],
    })
    expect(dto && 'passwordHash' in dto).toBe(false)
  })
})
