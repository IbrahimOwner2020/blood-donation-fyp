/**
 * Auth session cookie and TTL defaults (docs/10, docs/15).
 * Opaque session IDs are stored server-side in `sessions`; the cookie holds only the id.
 */

/** HTTP-only cookie name for the opaque session token. */
export const SESSION_COOKIE_NAME = 'nbts_session'

/** Default session lifetime: 7 days (seconds). Overridable via SESSION_TTL_SECONDS. */
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

/** Session primary key length (hex of 32 random bytes). */
export const SESSION_ID_BYTES = 32
