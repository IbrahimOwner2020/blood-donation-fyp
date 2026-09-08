import { describe, expect, mock, test } from 'bun:test'

import {
  AuthAuditActions,
  buildActivityMetadata,
  recordActivity,
  redactActivityMetadata,
  type ActivityLogInsertRow,
} from './index'

describe('redactActivityMetadata', () => {
  test('redacts sensitive keys and keeps safe fields', () => {
    const result = redactActivityMetadata({
      reason: 'bad_password',
      password: 'super-secret',
      email: 'officer@nbts.example',
      token: 'abc',
      attempt: 2,
    })

    expect(result).toEqual({
      reason: 'bad_password',
      password: '[REDACTED]',
      email: '[REDACTED]',
      token: '[REDACTED]',
      attempt: 2,
    })
  })

  test('returns null for empty / null input', () => {
    expect(redactActivityMetadata(null)).toBeNull()
    expect(redactActivityMetadata(undefined)).toBeNull()
    expect(redactActivityMetadata({})).toBeNull()
  })

  test('drops nested objects and arrays', () => {
    const result = redactActivityMetadata({
      ok: true,
      nested: { password: 'x' },
      list: [1, 2],
    } as Record<string, unknown>)
    expect(result).toEqual({ ok: true })
  })
})

describe('buildActivityMetadata', () => {
  test('merges requestId after redaction', () => {
    const result = buildActivityMetadata(
      { password: 'secret', reason: 'inactive' },
      'req-123',
    )
    expect(result).toEqual({
      password: '[REDACTED]',
      reason: 'inactive',
      requestId: 'req-123',
    })
  })

  test('returns requestId-only metadata when no other fields', () => {
    expect(buildActivityMetadata(null, 'req-only')).toEqual({
      requestId: 'req-only',
    })
  })
})

describe('recordActivity (mocked db insert)', () => {
  test('inserts redacted row with normalized fields', async () => {
    const inserted: ActivityLogInsertRow[] = []
    const insert = mock(async (row: ActivityLogInsertRow) => {
      inserted.push(row)
    })

    await recordActivity(
      {
        actorUserId: 7,
        action: AuthAuditActions.LOGIN_SUCCESS,
        entityType: 'user',
        entityId: 7,
        metadata: {
          password: 'should-not-persist',
          sessionCreated: true,
        },
        requestId: 'req-login-1',
        ipAddress: '127.0.0.1',
      },
      { insert },
    )

    expect(insert).toHaveBeenCalledTimes(1)
    expect(inserted[0]).toEqual({
      userId: 7,
      action: 'auth.login_success',
      entityType: 'user',
      entityId: '7',
      metadataJson: {
        password: '[REDACTED]',
        sessionCreated: true,
        requestId: 'req-login-1',
      },
      ipAddress: '127.0.0.1',
    })
  })

  test('allows null actor for anonymous failures', async () => {
    const inserted: ActivityLogInsertRow[] = []
    await recordActivity(
      {
        actorUserId: null,
        action: AuthAuditActions.LOGIN_FAILURE,
        entityType: 'auth',
        metadata: { reason: 'unknown_email' },
        requestId: 'req-fail',
      },
      {
        insert: async (row) => {
          inserted.push(row)
        },
      },
    )

    expect(inserted[0]?.userId).toBeNull()
    expect(inserted[0]?.action).toBe('auth.login_failure')
    expect(inserted[0]?.metadataJson).toEqual({
      reason: 'unknown_email',
      requestId: 'req-fail',
    })
  })

  test('skips insert when action or entityType missing', async () => {
    const insert = mock(async () => {})
    await recordActivity(
      { action: '', entityType: 'auth' },
      { insert },
    )
    await recordActivity(
      { action: 'x', entityType: '   ' },
      { insert },
    )
    expect(insert).toHaveBeenCalledTimes(0)
  })

  test('swallows insert errors without throwing', async () => {
    const insert = mock(async () => {
      throw new Error('db down')
    })

    await expect(
      recordActivity(
        {
          action: AuthAuditActions.LOGOUT,
          entityType: 'auth',
          metadata: { sessionRevoked: true },
        },
        { insert },
      ),
    ).resolves.toBeUndefined()

    expect(insert).toHaveBeenCalledTimes(1)
  })

  test('truncates long entityId and ip', async () => {
    const inserted: ActivityLogInsertRow[] = []
    await recordActivity(
      {
        action: AuthAuditActions.ME,
        entityType: 'user',
        entityId: 'e'.repeat(100),
        ipAddress: 'i'.repeat(80),
        actorUserId: 1,
      },
      {
        insert: async (row) => {
          inserted.push(row)
        },
      },
    )

    expect(inserted[0]?.entityId?.length).toBe(64)
    expect(inserted[0]?.ipAddress?.length).toBe(45)
  })
})
