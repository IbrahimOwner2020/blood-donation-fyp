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

import { getDb, withTransaction } from '../../db'
import { bloodGroups, donors, roles, userRoles, users } from '../../db/schema'
import { AppError } from '../../lib/errors'
import { getEnv } from '../../lib/env'
import { logInfo, logWarn } from '../../lib/logger'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody } from '../../lib/validate'
import { attachUserAccess } from '../../middleware/require-permission'
import { requireAuth } from '../../middleware/require-auth'
import { AuthAuditActions, recordActivity } from '../../services/audit'
import { DonorAuditActions } from '../../services/audit'
import {
  clearSessionCookie,
  readSessionId,
  resolveSessionCookieSettings,
  setSessionCookie,
} from './cookies'
import { DEFAULT_SESSION_TTL_SECONDS } from './constants'
import { hashPassword, verifyPassword } from './password'
import {
  changePasswordBodySchema,
  loginBodySchema,
  registerDonorBodySchema,
} from './schemas'
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
  | 'register_donor'

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
    register_donor: 'auth.register_donor',
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
      : event === 'register_donor'
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

function isDuplicateEntryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code =
    'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : ''
  const errno =
    'errno' in error && typeof (error as { errno?: unknown }).errno === 'number'
      ? (error as { errno: number }).errno
      : undefined
  const message =
    error instanceof Error
      ? error.message
      : 'message' in error && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : ''
  return (
    code === 'ER_DUP_ENTRY' ||
    errno === 1062 ||
    message.toLowerCase().includes('duplicate')
  )
}

async function generateUniqueDonorNumber(
  db: ReturnType<typeof getDb>,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()
    const donorNumber = `DON-${suffix}`
    const rows = await db
      .select({ id: donors.id })
      .from(donors)
      .where(eq(donors.donorNumber, donorNumber))
      .limit(1)
    if (!rows?.[0]?.id) {
      return donorNumber
    }
  }
  throw AppError.internal('Failed to generate donor number')
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
    facilityId: row.facilityId ?? null,
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
 * POST /auth/register-donor
 * Public donor self-registration. Creates an ACTIVE user, linked ACTIVE donor,
 * assigns Registered Donor, and starts a session immediately.
 */
authRoutes.post('/register-donor', async (c) => {
  const body = await parseJsonBody(c, registerDonorBodySchema)
  const db = getDb()
  const ip = clientIp(c)
  const requestId = c.get('requestId') ?? null

  try {
    const created = await withTransaction(db, async (tx) => {
      const bloodGroupRows = await tx
        .select({ id: bloodGroups.id })
        .from(bloodGroups)
        .where(eq(bloodGroups.id, body.bloodGroupId))
        .limit(1)

      if (!bloodGroupRows?.[0]?.id) {
        throw AppError.validation('Invalid blood group', [
          {
            path: 'bloodGroupId',
            message: 'Blood group does not exist',
            code: 'invalid_blood_group',
          },
        ])
      }

      const roleRows = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, 'Registered Donor'))
        .limit(1)

      const roleId = roleRows?.[0]?.id
      if (typeof roleId !== 'number') {
        throw AppError.internal('Registered Donor role is not seeded')
      }

      const donorNumber = await generateUniqueDonorNumber(db)
      const passwordHash = await hashPassword(body.password)

      await tx.insert(users).values({
        name: body.name,
        email: body.email,
        passwordHash,
        facilityId: null,
        status: 'ACTIVE',
      })

      const userRows = await tx
        .select()
        .from(users)
        .where(eq(users.email, body.email))
        .limit(1)
      const userRow = userRows?.[0]
      if (!userRow?.id) {
        throw AppError.internal('Failed to load registered user')
      }

      await tx.insert(userRoles).values({ userId: userRow.id, roleId })

      const insertedDonor = await tx
        .insert(donors)
        .values({
          userId: userRow.id,
          donorNumber,
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone,
          email: body.email,
          bloodGroupId: body.bloodGroupId,
          eligibilityStatus: 'UNKNOWN',
          active: true,
        })
        .$returningId()

      const donorId = insertedDonor?.[0]?.id
      if (typeof donorId !== 'number') {
        throw AppError.internal('Failed to create donor profile')
      }

      return { user: mapUserRow(userRow), donorId, donorNumber }
    })

    const ttl = sessionTtlSeconds()
    const session = await createSession(db, {
      userId: created.user.id,
      ipAddress: ip,
      userAgent: c.req.header('user-agent') ?? null,
      ttlSeconds: ttl,
    })

    setSessionCookie(c, session.id, { maxAgeSeconds: ttl })

    await recordAuthAuditEvent('register_donor', {
      actorUserId: created.user.id,
      requestId,
      ipAddress: ip,
    })
    await recordActivity({
      actorUserId: created.user.id,
      action: DonorAuditActions.CREATE,
      entityType: 'donor',
      entityId: created.donorId,
      metadata: {
        donorNumber: created.donorNumber,
        selfRegistered: true,
      },
      requestId,
      ipAddress: ip,
    })

    const publicUser = toPublicUser(created.user)
    if (!publicUser) {
      throw AppError.internal('Failed to serialize user')
    }

    return jsonOk(
      c,
      {
        user: publicUser,
        roles: ['Registered Donor'],
        permissions: [],
      },
      201,
    )
  } catch (error) {
    if (AppError.isAppError(error)) {
      throw error
    }
    if (isDuplicateEntryError(error)) {
      throw AppError.conflict('Email or phone is already registered', [
        {
          path: 'email',
          message: 'Email or phone is already registered',
          code: 'duplicate_registration',
        },
      ])
    }
    throw error
  }
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
