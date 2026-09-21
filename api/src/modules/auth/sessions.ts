/**
 * Server-side session create / revoke / validate against `sessions` table (docs/10).
 * Opaque session IDs; never embed user data in the cookie.
 */

import { and, eq, gt } from 'drizzle-orm'

import type { Db } from '../../db'
import { sessions, users } from '../../db/schema'
import type { UserStatus } from '../../db/schema/enums'
import { getEnv } from '../../lib/env'
import {
  DEFAULT_SESSION_TTL_SECONDS,
  SESSION_ID_BYTES,
} from './constants'
import type { PublicUser } from './serialize'

export type SessionRecord = {
  id: string
  userId: number
  expiresAt: Date
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
}

export type CreateSessionInput = {
  userId: number
  ipAddress?: string | null
  userAgent?: string | null
  /** Override TTL in seconds; defaults to SESSION_TTL_SECONDS / DEFAULT_SESSION_TTL_SECONDS. */
  ttlSeconds?: number
  /** Injected id for tests; production always generates a random id. */
  sessionId?: string
  /** Injected clock for tests. */
  now?: Date
}

export type ValidatedSession = {
  session: SessionRecord
  user: PublicUser
}

function resolveTtlSeconds(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.floor(override)
  }
  const envTtl = getEnv().SESSION_TTL_SECONDS
  if (typeof envTtl === 'number' && Number.isFinite(envTtl) && envTtl > 0) {
    return Math.floor(envTtl)
  }
  return DEFAULT_SESSION_TTL_SECONDS
}

/** Cryptographically random hex session id (64 chars for 32 bytes). */
export function generateSessionId(bytes = SESSION_ID_BYTES): string {
  const size = bytes > 0 ? bytes : SESSION_ID_BYTES
  const buffer = new Uint8Array(size)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Create a DB-backed session row and return it with computed expiry.
 */
export async function createSession(
  db: Db,
  input: CreateSessionInput,
): Promise<SessionRecord> {
  const now = input.now ?? new Date()
  const ttlSeconds = resolveTtlSeconds(input.ttlSeconds)
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
  const id = input.sessionId?.trim() || generateSessionId()

  await db.insert(sessions).values({
    id,
    userId: input.userId,
    expiresAt,
    ipAddress: input.ipAddress ?? null,
    userAgent: truncateUserAgent(input.userAgent),
    createdAt: now,
  })

  return {
    id,
    userId: input.userId,
    expiresAt,
    ipAddress: input.ipAddress ?? null,
    userAgent: truncateUserAgent(input.userAgent),
    createdAt: now,
  }
}

/**
 * Revoke a single session by id. Safe no-op if missing.
 */
export async function revokeSession(db: Db, sessionId: string | null | undefined): Promise<boolean> {
  const id = sessionId?.trim()
  if (!id) {
    return false
  }

  const result = await db.delete(sessions).where(eq(sessions.id, id))
  const affected = extractAffectedRows(result)
  return affected > 0
}

/**
 * Revoke all sessions for a user (e.g. after password change).
 */
export async function revokeAllUserSessions(db: Db, userId: number): Promise<number> {
  if (!Number.isFinite(userId) || userId <= 0) {
    return 0
  }
  const result = await db.delete(sessions).where(eq(sessions.userId, userId))
  return extractAffectedRows(result)
}

/**
 * Load a non-expired session joined with an ACTIVE user.
 * Returns null when the cookie is invalid, expired, or user is inactive.
 */
export async function findValidSession(
  db: Db,
  sessionId: string | null | undefined,
  now: Date = new Date(),
): Promise<ValidatedSession | null> {
  const id = sessionId?.trim()
  if (!id) {
    return null
  }

  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      sessionCreatedAt: sessions.createdAt,
      userName: users.name,
      userEmail: users.email,
      userFacilityId: users.facilityId,
      userStatus: users.status,
      userCreatedAt: users.createdAt,
      userUpdatedAt: users.updatedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1)

  const row = rows?.[0]
  if (!row) {
    return null
  }

  if (row.userStatus !== 'ACTIVE') {
    return null
  }

  const publicUser: PublicUser = {
    id: row.userId,
    name: row.userName,
    email: row.userEmail,
    facilityId: row.userFacilityId ?? null,
    status: row.userStatus as UserStatus,
    createdAt: row.userCreatedAt,
    updatedAt: row.userUpdatedAt,
  }

  return {
    session: {
      id: row.sessionId,
      userId: row.userId,
      expiresAt: row.expiresAt,
      ipAddress: row.ipAddress ?? null,
      userAgent: row.userAgent ?? null,
      createdAt: row.sessionCreatedAt,
    },
    user: publicUser,
  }
}

function truncateUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) {
    return null
  }
  return userAgent.length > 512 ? userAgent.slice(0, 512) : userAgent
}

/**
 * mysql2 / drizzle delete result shape varies; normalize affected row count.
 */
function extractAffectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: number } | undefined
    return header?.affectedRows ?? 0
  }
  if (result && typeof result === 'object' && 'affectedRows' in result) {
    const count = (result as { affectedRows?: number }).affectedRows
    return typeof count === 'number' ? count : 0
  }
  return 0
}

/**
 * Narrow store interface for unit tests that avoid a real MariaDB.
 */
export type SessionStore = {
  createSession: (input: CreateSessionInput) => Promise<SessionRecord>
  revokeSession: (sessionId: string | null | undefined) => Promise<boolean>
  findValidSession: (
    sessionId: string | null | undefined,
    now?: Date,
  ) => Promise<ValidatedSession | null>
}

/** Build a SessionStore bound to a Db instance (production path). */
export function createSessionStore(db: Db): SessionStore {
  return {
    createSession: (input) => createSession(db, input),
    revokeSession: (sessionId) => revokeSession(db, sessionId),
    findValidSession: (sessionId, now) => findValidSession(db, sessionId, now),
  }
}
