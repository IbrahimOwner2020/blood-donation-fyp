/**
 * Session cookie helpers — HTTP-only, Secure from COOKIE_SECURE, SameSite from
 * SESSION_COOKIE_SAME_SITE (docs/10, docs/15). Local defaults to Strict;
 * Railway split-domain deploys need SameSite=None with Secure=true.
 */

import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { getEnv } from '../../lib/env'
import { SESSION_COOKIE_NAME } from './constants'

export type SessionCookieOptions = {
  maxAgeSeconds: number
  secure?: boolean
}

export function resolveSessionCookieSettings(options: {
  secure?: boolean
} = {}): {
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
} {
  const env = getEnv()
  return {
    secure: options.secure ?? env.COOKIE_SECURE ?? false,
    sameSite: env.SESSION_COOKIE_SAME_SITE ?? 'Strict',
  }
}

/** Read opaque session id from the request cookie, if present. */
export function readSessionId(c: Context): string | undefined {
  const value = getCookie(c, SESSION_COOKIE_NAME)
  if (!value || typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Set the HTTP-only session cookie. */
export function setSessionCookie(
  c: Context,
  sessionId: string,
  options: SessionCookieOptions,
): void {
  const { secure, sameSite } = resolveSessionCookieSettings(options)

  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    path: '/',
    sameSite,
    secure,
    maxAge: options.maxAgeSeconds,
  })
}

/** Clear the session cookie (logout). */
export function clearSessionCookie(c: Context): void {
  const env = getEnv()
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    secure: env.COOKIE_SECURE ?? false,
  })
}
