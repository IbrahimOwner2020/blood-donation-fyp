/**
 * Auth module public surface (sessions, password hash, RBAC access helpers).
 *
 * Password hashing: Argon2id via Bun.password (no extra npm native binding).
 * Sessions: DB-backed opaque tokens in HTTP-only cookies.
 * RBAC: loadUserAccess / permission helpers (middleware in middleware/require-permission).
 */

export { SESSION_COOKIE_NAME, DEFAULT_SESSION_TTL_SECONDS, SESSION_ID_BYTES } from './constants'
export {
  hashPassword,
  verifyPassword,
  type HashPasswordOptions,
} from './password'
export {
  readSessionId,
  setSessionCookie,
  clearSessionCookie,
  type SessionCookieOptions,
} from './cookies'
export { loginBodySchema, changePasswordBodySchema, type LoginBody, type ChangePasswordBody } from './schemas'
export { toPublicUser, type PublicUser, type UserRow } from './serialize'
export {
  generateSessionId,
  createSession,
  revokeSession,
  revokeAllUserSessions,
  findValidSession,
  createSessionStore,
  type SessionRecord,
  type CreateSessionInput,
  type ValidatedSession,
  type SessionStore,
} from './sessions'
export {
  loadUserAccess,
  hasAllPermissions,
  hasAnyPermission,
  filterKnownPermissionCodes,
  type UserAccess,
  type ResolveUserAccess,
} from './user-access'
export { authRoutes } from './routes'
