import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { resetEnvCache } from '../lib/env'
import type { AppHonoEnv } from '../lib/types'
import { createCorsMiddleware } from './cors'

describe('createCorsMiddleware', () => {
  test('allows configured origin with credentials on preflight', async () => {
    resetEnvCache()
    const app = new Hono<AppHonoEnv>()
    app.use(
      '*',
      createCorsMiddleware({ trustedOrigins: ['http://localhost:5173'] }),
    )
    app.get('/ping', (c) => c.json({ ok: true }))

    const res = await app.request('/ping', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,X-Request-Id',
      },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    )
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(res.headers.get('Access-Control-Allow-Methods') ?? '').toContain(
      'POST',
    )
    expect(res.headers.get('Access-Control-Allow-Headers') ?? '').toContain(
      'Content-Type',
    )
    expect(res.headers.get('Access-Control-Expose-Headers') ?? '').toContain(
      'X-Request-Id',
    )
  })

  test('rejects unlisted origin', async () => {
    resetEnvCache()
    const app = new Hono<AppHonoEnv>()
    app.use(
      '*',
      createCorsMiddleware({ trustedOrigins: ['http://localhost:5173'] }),
    )
    app.get('/ping', (c) => c.json({ ok: true }))

    const res = await app.request('/ping', {
      method: 'GET',
      headers: {
        Origin: 'http://evil.example',
      },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  test('never uses wildcard origin', async () => {
    resetEnvCache()
    const app = new Hono<AppHonoEnv>()
    app.use(
      '*',
      createCorsMiddleware({ trustedOrigins: ['http://localhost:5173'] }),
    )
    app.post('/ping', (c) => c.json({ ok: true }))

    const res = await app.request('/ping', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })
})
