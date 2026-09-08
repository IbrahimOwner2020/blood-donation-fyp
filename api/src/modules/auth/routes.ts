/**
 * Auth routes: POST /login, POST /logout, GET /me (docs/04, docs/10).
 * Mounted under /api/v1/auth.
 *
 * Security (auth-hardening): CSRF origin check (via app mount), uniform login
 * errors (no user enumeration), log redaction via lib/logger.
 * Audit: activity_logs via recordActivity (docs/10 Audit Events).
 */

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../../db'
import { users } from '../../db/schema'
import { AppError } from '../../lib/errors'
import { getEnv } from '../../lib/env'
import { logInfo, logWarn } from '../../lib/logger'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody } from '../../lib/validate'
import { attachUserAccess } from '../../middleware/require-permission'
import { requireAuth } from '../../middleware/require-auth'
import { AuthAuditActions, recordActivity } from '../../services/audit'
import {
  clearSessionCookie,
  readSessionId,
  resolveSessionCookieSettings,
  setSessionCookie,
} from './cookies'
import { DEFAULT_SESSION_TTL_SECONDS } from './constants'
import { hashPassword, verifyPassword } from './password'
import { changePasswordBodySchema, loginBodySchema } from './schemas'
import { toPublicUser, type UserRow } from './serialize'
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
} from './sessions'

/** Uniform client message — never reveal whether email exists or account status. */
const INVALID_CREDENTIALS = 'Invalid email or password'

/** Lazy dummy Argon2id hash so unknown-email paths still pay verify cost. */
let timingDummyHashPromise: Promise<string> | null = null

function getTimingDummyHash(): Promise<string> {
  if (!timingDummyHashPromise) {
    timingDummyHashPromise = hashPassword('__nbts_timing_dummy__')
  }
  return timingDummyHashPromise
}

type AuthAuditEvent =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'me'
  | 'change_password'

/**
 * Adapter from auth route call sites → activity_logs writer.
 * Failures are swallowed inside recordActivity so auth is never blocked.
 */
async function recordAuthAuditEvent(
  event: AuthAuditEvent,
  meta: {
    actorUserId?: number | null
    reason?: string
    sessionRevoked?: boolean
    userId?: number
    requestId?: string | null
    ipAddress?: string | null
  } = {},
): Promise<void> {
  const actionByEvent = {
    login_success: AuthAuditActions.LOGIN_SUCCESS,
    login_failure: AuthAuditActions.LOGIN_FAILURE,
    logout: AuthAuditActions.LOGOUT,
    me: AuthAuditActions.ME,
    change_password: AuthAuditActions.CHANGE_PASSWORD,
  } as const

  const actorUserId =
    typeof meta.actorUserId === 'number'
      ? meta.actorUserId
      : typeof meta.userId === 'number'
        ? meta.userId
        : null

  const entityType =
    event === 'login_success' ||
    event === 'me' ||
    event === 'change_password'
      ? 'user'
      : 'auth'

  const metadata: Record<string, string | number | boolean | null | undefined> =
    {}
  if (meta.reason) {
    metadata.reason = meta.reason
  }
  if (typeof meta.sessionRevoked === 'boolean') {
    metadata.sessionRevoked = meta.sessionRevoked
  }
  if (event === 'login_success') {
    metadata.sessionCreated = true
  }

  await recordActivity({
    actorUserId,
    action: actionByEvent[event],
    entityType,
    entityId:
      entityType === 'user' && typeof actorUserId === 'number'
        ? actorUserId
        : null,
    metadata,
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
  })
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    return first || null
  }
  return c.req.header('x-real-ip')?.trim() || null
}

function sessionTtlSeconds(): number {
  const ttl = getEnv().SESSION_TTL_SECONDS
  return typeof ttl === 'number' && ttl > 0 ? ttl : DEFAULT_SESSION_TTL_SECONDS
}

function mapUserRow(row: typeof users.$inferSelect): UserRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export const authRoutes = new Hono<AppHonoEnv>()

/**
 * POST /auth/login
 * Body: { email, password }
 * Sets HTTP-only session cookie; returns public user (no passwordHash).
 */
authRoutes.post('/login', async (c) => {
  const body = await parseJsonBody(c, loginBodySchema)
  const email = body.email.trim().toLowerCase()
  const db = getDb()
  const ip = clientIp(c)
  const requestId = c.get('requestId') ?? null

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  const row = rows?.[0]
  const user = row ? mapUserRow(row) : null

  const hashToVerify = user?.passwordHash ?? (await getTimingDummyHash())
  const passwordOk = await verifyPassword(body.password, hashToVerify)

  if (!user || user.status !== 'ACTIVE' || !passwordOk) {
    const reason = !user ? 'unknown_email' : user.status !== 'ACTIVE' ? 'inactive' : 'bad_password'
    // Do not log email/password; logger redacts email if ever passed.
    logWarn('auth.login_failed', {
      reason,
      ...(user ? { userId: user.id } : {}),
    })
    await recordAuthAuditEvent('login_failure', {
      reason,
      actorUserId: user?.id ?? null,
      requestId,
      ipAddress: ip,
    })
    throw AppError.unauthorized(INVALID_CREDENTIALS)
  }

  const ttl = sessionTtlSeconds()
  const session = await createSession(db, {
    userId: user.id,
    ipAddress: ip,
    userAgent: c.req.header('user-agent') ?? null,
    ttlSeconds: ttl,
  })

  const cookieSettings = resolveSessionCookieSettings()
  setSessionCookie(c, session.id, { maxAgeSeconds: ttl })
  logInfo('auth.login_success', { userId: user.id, cookieSettings })
  await recordAuthAuditEvent('login_success', {
    userId: user.id,
    requestId,
    ipAddress: ip,
  })

  const publicUser = toPublicUser(user)
  if (!publicUser) {
    throw AppError.internal('Failed to serialize user')
  }

  return jsonOk(c, { user: publicUser })
})

/**
 * POST /auth/logout
 * Revokes the current DB session (if any) and clears the cookie.
 */
authRoutes.post('/logout', async (c) => {
  const sessionId = readSessionId(c)
  const db = getDb()
  const requestId = c.get('requestId') ?? null
  const ip = clientIp(c)
  const actorUserId = c.get('user')?.id ?? null
  let sessionRevoked = false

  if (sessionId) {
    await revokeSession(db, sessionId)
    sessionRevoked = true
    logInfo('auth.logout', { sessionRevoked: true })
  }

  await recordAuthAuditEvent('logout', {
    actorUserId,
    sessionRevoked,
    requestId,
    ipAddress: ip,
  })

  clearSessionCookie(c)
  return jsonOk(c, { ok: true })
})

/**
 * GET /auth/me
 * Requires a valid session; returns public user plus roles/permissions (no secrets).
 */
authRoutes.get('/me', requireAuth, attachUserAccess(), async (c) => {
  const user = c.get('user')
  if (!user) {
    throw AppError.unauthorized('Authentication required')
  }

  await recordAuthAuditEvent('me', {
    actorUserId: user.id,
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })

  return jsonOk(c, {
    user,
    roles: c.get('roles') ?? [],
    permissions: c.get('permissions') ?? [],
  })
})

/**
 * POST /auth/change-password
 * Body: { currentPassword, newPassword }
 * Verifies current password, re-hashes with Argon2id, revokes all sessions,
 * then issues a fresh session cookie for the caller.
 */
authRoutes.post('/change-password', requireAuth, async (c) => {
  const body = await parseJsonBody(c, changePasswordBodySchema)
  const actor = c.get('user')
  if (!actor?.id) {
    throw AppError.unauthorized('Authentication required')
  }

  const db = getDb()
  const ip = clientIp(c)
  const requestId = c.get('requestId') ?? null

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1)
  const row = rows?.[0]
  if (!row) {
    throw AppError.unauthorized('Authentication required')
  }

  const user = mapUserRow(row)
  if (user.status !== 'ACTIVE') {
    throw AppError.unauthorized('Authentication required')
  }

  const currentOk = await verifyPassword(body.currentPassword, user.passwordHash)
  if (!currentOk) {
    logWarn('auth.change_password_failed', {
      reason: 'bad_current_password',
      userId: user.id,
    })
    throw AppError.unauthorized('Current password is incorrect')
  }

  const newHash = await hashPassword(body.newPassword)
  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, user.id))

  const sessionsRevoked = await revokeAllUserSessions(db, user.id)
  const ttl = sessionTtlSeconds()
  const session = await createSession(db, {
    userId: user.id,
    ipAddress: ip,
    userAgent: c.req.header('user-agent') ?? null,
    ttlSeconds: ttl,
  })
  setSessionCookie(c, session.id, { maxAgeSeconds: ttl })

  logInfo('auth.change_password', {
    userId: user.id,
    sessionsRevoked,
  })
  await recordAuthAuditEvent('change_password', {
    userId: user.id,
    sessionRevoked: sessionsRevoked > 0,
    requestId,
    ipAddress: ip,
  })

  const publicUser = toPublicUser({
    ...user,
    updatedAt: new Date(),
  })
  if (!publicUser) {
    throw AppError.internal('Failed to serialize user')
  }

  return jsonOk(c, { ok: true, user: publicUser })
})
