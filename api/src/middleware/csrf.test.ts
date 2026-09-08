import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { AppError } from '../lib/errors'
import { resetEnvCache } from '../lib/env'
import type { AppHonoEnv } from '../lib/types'
import {
  createCsrfProtection,
  isTrustedOrigin,
  parseTrustedOrigins,
  resolveRequestOrigin,
} from './csrf'

describe('parseTrustedOrigins', () => {
  test('splits and trims comma-separated origins', () => {
    expect(parseTrustedOrigins(' http://a.example ,http://b.example/ ')).toEqual([
      'http://a.example',
      'http://b.example',
    ])
  })

  test('returns empty for blank input', () => {
    expect(parseTrustedOrigins('')).toEqual([])
    expect(parseTrustedOrigins(null)).toEqual([])
  })
})

describe('resolveRequestOrigin / isTrustedOrigin', () => {
  test('prefers Origin over Referer', () => {
    expect(
      resolveRequestOrigin('https://app.example', 'https://other.example/path'),
    ).toBe('https://app.example')
  })

  test('falls back to Referer origin', () => {
    expect(resolveRequestOrigin(undefined, 'https://app.example/login')).toBe(
      'https://app.example',
    )
  })

  test('isTrustedOrigin matches exact origin', () => {
    expect(isTrustedOrigin('http://localhost:5173', ['http://localhost:5173'])).toBe(true)
    expect(isTrustedOrigin('http://evil.example', ['http://localhost:5173'])).toBe(false)
  })
})

describe('createCsrfProtection', () => {
  test('allows GET without origin', async () => {
    const app = new Hono<AppHonoEnv>()
    app.use('*', createCsrfProtection({ trustedOrigins: ['http://localhost:5173'] }))
    app.get('/me', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/me')
    expect(res.status).toBe(200)
  })

  test('allows POST without Origin/Referer (non-browser)', async () => {
    const app = new Hono<AppHonoEnv>()
    app.use('*', createCsrfProtection({ trustedOrigins: ['http://localhost:5173'] }))
    app.post('/login', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/login', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  test('rejects POST with untrusted Origin', async () => {
    resetEnvCache()
    const app = new Hono<AppHonoEnv>()
    app.onError((err, c) => {
      if (AppError.isAppError(err)) {
        return c.json({ message: err.message }, err.status as 403)
      }
      return c.json({ message: 'error' }, 500)
    })
    app.use('*', createCsrfProtection({ trustedOrigins: ['http://localhost:5173'] }))
    app.post('/login', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/login', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
  })

  test('allows POST with trusted Origin', async () => {
    const app = new Hono<AppHonoEnv>()
    app.use('*', createCsrfProtection({ trustedOrigins: ['http://localhost:5173'] }))
    app.post('/login', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
  })
})
