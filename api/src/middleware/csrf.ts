/**
 * CSRF protection for the cookie session model (docs/10).
 *
 * Approach (SameSite=Strict + Origin/Referer check — not double-submit):
 *
 * 1. Session cookie (`nbts_session`) is HttpOnly and SameSite=Strict
 *    (see modules/auth/cookies.ts). Browsers will not attach it on
 *    cross-site POSTs, which blocks classic CSRF.
 *
 * 2. For unsafe methods (POST/PUT/PATCH/DELETE), we additionally require
 *    that when a browser sends Origin or Referer, it matches APP_ORIGINS.
 *    This covers older clients and defense-in-depth if SameSite is weakened.
 *
 * 3. Double-submit CSRF tokens are omitted for MVP: they need a readable
 *    cookie + frontend header wiring, while SameSite=Strict + origin checks
 *    already fit the existing opaque HttpOnly session cookie.
 *
 * Non-browser clients (curl, server-to-server) that omit Origin and Referer
 * are allowed. Requests that present a foreign Origin/Referer are rejected.
 */

import { createMiddleware } from 'hono/factory'

import { getEnv } from '../lib/env'
import { AppError } from '../lib/errors'
import type { AppHonoEnv } from '../lib/types'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export type CsrfOptions = {
  /** Explicit allow-list; defaults to env APP_ORIGINS (comma-separated). */
  trustedOrigins?: string[]
  /** When true, missing Origin and Referer are rejected (strict browsers-only). */
  requireOriginHeader?: boolean
}

/** Parse comma-separated origin list into normalized origins (no trailing slash). */
export function parseTrustedOrigins(raw: string | undefined | null): string[] {
  if (!raw || typeof raw !== 'string') {
    return []
  }
  return raw
    .split(',')
    .map((part) => part.trim().replace(/\/$/, ''))
    .filter((part) => part.length > 0)
}

function originFromUrl(value: string | undefined | null): string | null {
  if (!value || typeof value !== 'string') {
    return null
  }
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    return null
  }
}

/**
 * Resolve the request's claimed origin from Origin, else Referer.
 */
export function resolveRequestOrigin(
  originHeader: string | undefined,
  refererHeader: string | undefined,
): string | null {
  const fromOrigin = originFromUrl(originHeader?.trim())
  if (fromOrigin) {
    return fromOrigin
  }
  return originFromUrl(refererHeader?.trim())
}

export function isTrustedOrigin(origin: string, trusted: string[]): boolean {
  const normalized = origin.replace(/\/$/, '')
  return trusted.some((allowed) => allowed === normalized)
}

/**
 * Middleware: Origin/Referer allow-list for unsafe HTTP methods.
 */
export function createCsrfProtection(options: CsrfOptions = {}) {
  return createMiddleware<AppHonoEnv>(async (c, next) => {
    const method = (c.req.method ?? 'GET').toUpperCase()
    if (!UNSAFE_METHODS.has(method)) {
      await next()
      return
    }

    const env = getEnv()
    const trusted =
      options.trustedOrigins ?? parseTrustedOrigins(env.APP_ORIGINS)

    // Misconfiguration: empty allow-list would block all browser clients.
    if (trusted.length === 0) {
      await next()
      return
    }

    const requestOrigin = resolveRequestOrigin(
      c.req.header('origin'),
      c.req.header('referer'),
    )

    if (!requestOrigin) {
      if (options.requireOriginHeader) {
        throw AppError.forbidden('Missing Origin')
      }
      await next()
      return
    }

    if (!isTrustedOrigin(requestOrigin, trusted)) {
      throw AppError.forbidden('Invalid request origin')
    }

    await next()
  })
}

/** Default CSRF middleware using APP_ORIGINS from env. */
export const csrfProtection = createCsrfProtection()
