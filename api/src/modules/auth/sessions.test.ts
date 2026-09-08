import { describe, expect, test } from 'bun:test'

import type { PublicUser } from './serialize'
import {
  generateSessionId,
  type CreateSessionInput,
  type SessionRecord,
  type SessionStore,
  type ValidatedSession,
} from './sessions'

/**
 * In-memory SessionStore mock — exercises create/revoke/findValid semantics
 * without MariaDB (practical unit isolation).
 */
function createMemorySessionStore(seedUser: PublicUser): SessionStore {
  const rows = new Map<string, SessionRecord>()

  return {
    async createSession(input: CreateSessionInput): Promise<SessionRecord> {
      const now = input.now ?? new Date()
      const ttlSeconds = input.ttlSeconds ?? 3600
      const id = input.sessionId?.trim() || generateSessionId()
      const record: SessionRecord = {
        id,
        userId: input.userId,
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        createdAt: now,
      }
      rows.set(id, record)
      return record
    },

    async revokeSession(sessionId: string | null | undefined): Promise<boolean> {
      const id = sessionId?.trim()
      if (!id || !rows.has(id)) {
        return false
      }
      rows.delete(id)
      return true
    },

    async findValidSession(
      sessionId: string | null | undefined,
      now: Date = new Date(),
    ): Promise<ValidatedSession | null> {
      const id = sessionId?.trim()
      if (!id) {
        return null
      }
      const session = rows.get(id)
      if (!session) {
        return null
      }
      if (session.expiresAt.getTime() <= now.getTime()) {
        return null
      }
      if (session.userId !== seedUser.id || seedUser.status !== 'ACTIVE') {
        return null
      }
      return { session, user: seedUser }
    },
  }
}

describe('generateSessionId', () => {
  test('returns 64-char hex for 32 bytes', () => {
    const id = generateSessionId(32)
    expect(id).toMatch(/^[0-9a-f]{64}$/)
  })

  test('produces unique values', () => {
    const a = generateSessionId()
    const b = generateSessionId()
    expect(a).not.toBe(b)
  })
})

describe('SessionStore (mocked db semantics)', () => {
  const user: PublicUser = {
    id: 42,
    name: 'NBTS Officer',
    email: 'officer@nbts.example',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }

  test('createSession then findValidSession returns user without secrets', async () => {
    const store = createMemorySessionStore(user)
    const now = new Date('2026-09-02T10:00:00.000Z')

    const session = await store.createSession({
      userId: user.id,
      ttlSeconds: 3600,
      now,
      sessionId: 'a'.repeat(64),
      ipAddress: '127.0.0.1',
      userAgent: 'bun-test',
    })

    expect(session.id).toBe('a'.repeat(64))
    expect(session.userId).toBe(42)
    expect(session.expiresAt.getTime()).toBe(now.getTime() + 3600_000)

    const validated = await store.findValidSession(session.id, now)
    expect(validated?.user).toEqual(user)
    expect(validated?.session.id).toBe(session.id)
    expect(JSON.stringify(validated)).not.toContain('passwordHash')
  })

  test('findValidSession returns null for expired sessions', async () => {
    const store = createMemorySessionStore(user)
    const createdAt = new Date('2026-09-02T10:00:00.000Z')
    const session = await store.createSession({
      userId: user.id,
      ttlSeconds: 60,
      now: createdAt,
      sessionId: 'b'.repeat(64),
    })

    const afterExpiry = new Date(createdAt.getTime() + 61_000)
    await expect(store.findValidSession(session.id, afterExpiry)).resolves.toBeNull()
  })

  test('revokeSession removes the session', async () => {
    const store = createMemorySessionStore(user)
    const session = await store.createSession({
      userId: user.id,
      ttlSeconds: 3600,
      sessionId: 'c'.repeat(64),
    })

    await expect(store.revokeSession(session.id)).resolves.toBe(true)
    await expect(store.findValidSession(session.id)).resolves.toBeNull()
    await expect(store.revokeSession(session.id)).resolves.toBe(false)
    await expect(store.revokeSession(null)).resolves.toBe(false)
    await expect(store.findValidSession('')).resolves.toBeNull()
  })
})
