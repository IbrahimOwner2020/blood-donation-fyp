/**
 * Zod schema unit tests for activity log list query.
 */

import { describe, expect, test } from 'bun:test'

import { listActivityLogsQuerySchema } from './schemas'

describe('listActivityLogsQuerySchema', () => {
  test('applies default limit and offset', () => {
    const parsed = listActivityLogsQuerySchema.parse({})
    expect(parsed.limit).toBe(50)
    expect(parsed.offset).toBe(0)
  })

  test('parses filters including ISO datetimes', () => {
    const parsed = listActivityLogsQuerySchema.parse({
      userId: '3',
      action: 'auth.login_success',
      entityType: 'user',
      entityId: '3',
      q: 'login',
      createdFrom: '2026-09-01T00:00:00.000Z',
      createdTo: '2026-09-02T00:00:00.000Z',
      limit: '25',
      offset: '10',
    })

    expect(parsed.userId).toBe(3)
    expect(parsed.action).toBe('auth.login_success')
    expect(parsed.entityType).toBe('user')
    expect(parsed.entityId).toBe('3')
    expect(parsed.q).toBe('login')
    expect(parsed.createdFrom?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(parsed.createdTo?.toISOString()).toBe('2026-09-02T00:00:00.000Z')
    expect(parsed.limit).toBe(25)
    expect(parsed.offset).toBe(10)
  })

  test('rejects invalid datetime', () => {
    const result = listActivityLogsQuerySchema.safeParse({
      createdFrom: 'not-a-date',
    })
    expect(result.success).toBe(false)
  })
})
