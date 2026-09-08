/**
 * Browser CORS for cookie-authenticated SPA clients (web-login → API).
 *
 * Origins come from APP_ORIGINS (same allow-list as CSRF). Never reflects
 * arbitrary Origin and never uses `*` when credentials are enabled.
 *
 * Note on SameSite=Strict: http://localhost:5173|5174 → http://localhost:3000 is
 * cross-origin (CORS required) but same-site (scheme + host), so Strict
 * session cookies should still be sent. If a browser still blocks the cookie,
 * check DevTools → Network → Set-Cookie / request Cookie before weakening SameSite.
 */

import { cors } from 'hono/cors'

import { getEnv } from '../lib/env'
import { parseTrustedOrigins } from './csrf'

export type CorsOptions = {
  /** Explicit allow-list; defaults to env APP_ORIGINS (comma-separated). */
  trustedOrigins?: string[]
}

const ALLOW_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] as const
const ALLOW_HEADERS = ['Content-Type', 'Cookie', 'X-Request-Id'] as const
const EXPOSE_HEADERS = ['X-Request-Id'] as const

/**
 * Build CORS middleware with an exact origin allow-list and credentials.
 */
export function createCorsMiddleware(options: CorsOptions = {}) {
  return cors({
    origin: (origin) => {
      if (!origin || typeof origin !== 'string') {
        return null
      }
      const normalized = origin.trim().replace(/\/$/, '')
      if (normalized.length === 0) {
        return null
      }
      const env = getEnv()
      const trusted =
        options.trustedOrigins ?? parseTrustedOrigins(env.APP_ORIGINS)
      return trusted.includes(normalized) ? normalized : null
    },
    credentials: true,
    allowMethods: [...ALLOW_METHODS],
    allowHeaders: [...ALLOW_HEADERS],
    exposeHeaders: [...EXPOSE_HEADERS],
  })
}

/** Default CORS middleware using APP_ORIGINS from env. */
export const corsMiddleware = createCorsMiddleware()
