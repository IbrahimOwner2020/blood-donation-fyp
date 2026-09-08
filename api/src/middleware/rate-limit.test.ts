import { describe, expect, test, beforeEach } from 'bun:test'
import { Hono } from 'hono'

import { AppError, ErrorCodes } from '../lib/errors'
import type { AppHonoEnv } from '../lib/types'
import { createLoginRateLimit, createRateLimit, clientIpKey } from './rate-limit'

describe('createRateLimit', () => {
  const store = new Map()

  beforeEach(() => {
    store.clear()
  })

  test('allows requests under the max and blocks at the limit', async () => {
    const limiter = createRateLimit({
      windowMs: 60_000,
      max: 2,
      keyFn: () => 'test-key',
      store,
    })

    const app = new Hono<AppHonoEnv>()
    app.onError((err, c) => {
      if (AppError.isAppError(err)) {
        return c.json({ code: err.code, message: err.message }, err.status as 429)
      }
      return c.json({ message: 'error' }, 500)
    })
    app.post('/hit', limiter, (c) => c.json({ ok: true }))

    const first = await app.request('http://localhost/hit', { method: 'POST' })
    const second = await app.request('http://localhost/hit', { method: 'POST' })
    const third = await app.request('http://localhost/hit', { method: 'POST' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(third.status).toBe(429)
    expect(third.headers.get('Retry-After')).toBeTruthy()
    const body = (await third.json()) as { code: string }
    expect(body.code).toBe(ErrorCodes.RATE_LIMITED)
  })

  test('clientIpKey prefers first X-Forwarded-For hop', async () => {
    let key = ''
    const limiter = createRateLimit({
      windowMs: 1000,
      max: 10,
      keyFn: (c) => {
        key = clientIpKey(c)
        return key
      },
      store,
    })
    const limited = new Hono<AppHonoEnv>()
    limited.post('/x', limiter, (c) => c.json({ ok: true }))
    await limited.request('http://localhost/x', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
    })
    expect(key).toBe('ip:203.0.113.10')
  })
})

describe('createLoginRateLimit', () => {
  test('uses login-specific message', async () => {
    const store = new Map()
    const limiter = createLoginRateLimit({ windowMs: 60_000, max: 1, store })
    const app = new Hono<AppHonoEnv>()
    app.onError((err, c) => {
      if (AppError.isAppError(err)) {
        return c.json({ code: err.code, message: err.message }, err.status as 429)
      }
      return c.json({ message: 'error' }, 500)
    })
    app.post('/login', limiter, (c) => c.json({ ok: true }))

    await app.request('http://localhost/login', { method: 'POST' })
    const blocked = await app.request('http://localhost/login', { method: 'POST' })
    const body = (await blocked.json()) as { message: string }
    expect(blocked.status).toBe(429)
    expect(body.message).toContain('login')
  })
})
