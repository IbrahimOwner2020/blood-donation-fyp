import { describe, expect, test } from 'bun:test'

import {
  toPublicActivityLog,
  toPublicActivityMetadata,
} from './serialize'

describe('toPublicActivityMetadata', () => {
  test('redacts sensitive keys on read', () => {
    const result = toPublicActivityMetadata({
      password: 'secret-value',
      phone: '+255700000000',
      email: 'donor@example.com',
      requestId: 'req-123',
      status: 'ACTIVE',
    })

    expect(result).toEqual({
      password: '[REDACTED]',
      phone: '[REDACTED]',
      email: '[REDACTED]',
      requestId: 'req-123',
      status: 'ACTIVE',
    })
  })

  test('returns null for empty or null metadata', () => {
    expect(toPublicActivityMetadata(null)).toBeNull()
    expect(toPublicActivityMetadata(undefined)).toBeNull()
    expect(toPublicActivityMetadata({})).toBeNull()
  })
})

describe('toPublicActivityLog', () => {
  test('maps row + actor without exposing email', () => {
    const createdAt = new Date('2026-09-01T12:00:00.000Z')
    const publicLog = toPublicActivityLog(
      {
        id: 7,
        userId: 3,
        action: 'auth.login_success',
        entityType: 'user',
        entityId: '3',
        metadataJson: { token: 'abc', requestId: 'r1' },
        ipAddress: '127.0.0.1',
        createdAt,
      },
      { id: 3, name: 'Demo Admin' },
    )

    expect(publicLog).toEqual({
      id: 7,
      userId: 3,
      actorName: 'Demo Admin',
      action: 'auth.login_success',
      entityType: 'user',
      entityId: '3',
      metadata: { token: '[REDACTED]', requestId: 'r1' },
      ipAddress: '127.0.0.1',
      createdAt,
    })
  })

  test('handles missing actor and null userId', () => {
    const createdAt = new Date('2026-09-01T12:00:00.000Z')
    const publicLog = toPublicActivityLog(
      {
        id: 1,
        userId: null,
        action: 'system.boot',
        entityType: 'system',
        entityId: null,
        metadataJson: null,
        ipAddress: null,
        createdAt,
      },
      null,
    )

    expect(publicLog?.userId).toBeNull()
    expect(publicLog?.actorName).toBeNull()
    expect(publicLog?.metadata).toBeNull()
  })

  test('returns null for invalid row', () => {
    expect(toPublicActivityLog(null)).toBeNull()
    expect(toPublicActivityLog(undefined)).toBeNull()
  })
})
