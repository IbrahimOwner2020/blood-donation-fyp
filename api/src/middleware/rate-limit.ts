/**
 * In-memory fixed-window rate limiter (MVP).
 * Suitable for single-process Bun; replace with Redis/shared store for multi-instance.
 */

import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'

import { AppError } from '../lib/errors'
import type { AppHonoEnv } from '../lib/types'

export type RateLimitBucket = {
  count: number
  resetAt: number
}

export type RateLimitOptions = {
  /** Sliding fixed window length in milliseconds. */
  windowMs: number
  /** Max requests per key within the window. */
  max: number
  /** Build a rate-limit key from the request (e.g. IP). */
  keyFn: (c: Context<AppHonoEnv>) => string
  /** Client-facing message when limited. */
  message?: string
  /** Optional shared store (tests / multi-middleware sharing). */
  store?: Map<string, RateLimitBucket>
}

export type RateLimitMiddleware = ReturnType<typeof createRateLimit> & {
  /** Test helper — clear buckets. */
  resetStore: () => void
  /** Test helper — inspect store size. */
  storeSize: () => number
}

function clientIpKey(c: Context<AppHonoEnv>): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) {
      return `ip:${first}`
    }
  }
  const realIp = c.req.header('x-real-ip')?.trim()
  if (realIp) {
    return `ip:${realIp}`
  }
  return 'ip:unknown'
}

/**
 * Create a fixed-window rate-limit middleware.
 * Increments before the handler; failed and successful requests both count.
 */
export function createRateLimit(options: RateLimitOptions): RateLimitMiddleware {
  const windowMs = options.windowMs > 0 ? options.windowMs : 60_000
  const max = options.max > 0 ? options.max : 5
  const message = options.message ?? 'Too many requests. Try again later.'
  const store = options.store ?? new Map<string, RateLimitBucket>()

  const middleware = createMiddleware<AppHonoEnv>(async (c, next) => {
    const key = options.keyFn(c) || 'unknown'
    const now = Date.now()
    let bucket = store.get(key)

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs }
      store.set(key, bucket)
    }

    if (bucket.count >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      c.header('Retry-After', String(retryAfterSec))
      throw AppError.rateLimited(message)
    }

    bucket.count += 1
    await next()
  })

  const wrapped = middleware as RateLimitMiddleware
  wrapped.resetStore = () => {
    store.clear()
  }
  wrapped.storeSize = () => store.size
  return wrapped
}

/** Default key: client IP from X-Forwarded-For / X-Real-IP. */
export { clientIpKey }

/**
 * Login-oriented limiter: IP key, configurable window/max via options.
 */
export function createLoginRateLimit(options: {
  windowMs: number
  max: number
  store?: Map<string, RateLimitBucket>
}): RateLimitMiddleware {
  return createRateLimit({
    windowMs: options.windowMs,
    max: options.max,
    keyFn: clientIpKey,
    message: 'Too many login attempts. Try again later.',
    store: options.store,
  })
}
