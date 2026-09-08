import { describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'

import { AppError, ErrorCodes } from '../lib/errors'
import { errorHandler } from './error-handler'
import type { AuthUser, AppHonoEnv } from '../lib/types'
import type { ResolveUserAccess, UserAccess } from '../modules/auth/user-access'
import {
  attachUserAccess,
  createRequirePermission,
} from './require-permission'

const activeUser: AuthUser = {
  id: 42,
  name: 'Test Officer',
  email: 'officer@example.com',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function createAccessMock(access: UserAccess) {
  return mock(async (_userId: number): Promise<UserAccess> => ({
    roles: [...(access.roles ?? [])],
    permissions: [...(access.permissions ?? [])],
  }))
}

function buildApp(options: {
  user?: AuthUser | null
  loadAccess: ResolveUserAccess
  permissionCodes?: [string, ...string[]]
  preloaded?: UserAccess
}) {
  const app = new Hono<AppHonoEnv>()
  app.onError(errorHandler)

  app.use('*', async (c, next) => {
    if (options.user) {
      c.set('user', options.user)
      c.set('sessionId', 'test-session')
    }
    if (options.preloaded) {
      c.set('roles', options.preloaded.roles)
      c.set('permissions', options.preloaded.permissions)
    }
    await next()
  })

  const codes = options.permissionCodes ?? (['inventory:update'] as [string, ...string[]])

  app.get(
    '/protected',
    createRequirePermission(codes, { loadAccess: options.loadAccess }),
    (c) =>
      c.json({
        ok: true,
        roles: c.get('roles') ?? [],
        permissions: c.get('permissions') ?? [],
      }),
  )

  app.get(
    '/me-access',
    attachUserAccess({ loadAccess: options.loadAccess }),
    (c) =>
      c.json({
        roles: c.get('roles') ?? [],
        permissions: c.get('permissions') ?? [],
      }),
  )

  return app
}

describe('createRequirePermission', () => {
  test('allows request when all required permissions are granted', async () => {
    const loadAccess = createAccessMock({
      roles: ['NBTS Blood Bank Officer'],
      permissions: ['inventory:read', 'inventory:update'],
    })
    const app = buildApp({ user: activeUser, loadAccess })

    const res = await app.request('/protected')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      permissions: string[]
    }
    expect(body.ok).toBe(true)
    expect(body.permissions).toContain('inventory:update')
    expect(loadAccess).toHaveBeenCalledWith(42)
  })

  test('returns 403 when a required permission is missing', async () => {
    const loadAccess = createAccessMock({
      roles: ['Authorized Manager'],
      permissions: ['reports:read', 'predictions:read'],
    })
    const app = buildApp({
      user: activeUser,
      loadAccess,
      permissionCodes: ['inventory:update'],
    })

    const res = await app.request('/protected')
    expect(res.status).toBe(403)
    const body = (await res.json()) as {
      error?: { code?: string; message?: string }
    }
    expect(body.error?.code).toBe(ErrorCodes.FORBIDDEN)
    expect(body.error?.message).toBe('Insufficient permissions')
  })

  test('returns 401 when user is not on context', async () => {
    const loadAccess = createAccessMock({ roles: [], permissions: [] })
    const app = buildApp({ user: null, loadAccess })

    const res = await app.request('/protected')
    expect(res.status).toBe(401)
    const body = (await res.json()) as {
      error?: { code?: string }
    }
    expect(body.error?.code).toBe(ErrorCodes.UNAUTHORIZED)
    expect(loadAccess).not.toHaveBeenCalled()
  })

  test('requires every code when multiple are listed (AND)', async () => {
    const loadAccess = createAccessMock({
      roles: ['System Administrator'],
      permissions: ['users:manage'],
    })
    const app = buildApp({
      user: activeUser,
      loadAccess,
      permissionCodes: ['users:manage', 'roles:manage'],
    })

    const res = await app.request('/protected')
    expect(res.status).toBe(403)
  })

  test('skips loader when roles and permissions already on context', async () => {
    const loadAccess = createAccessMock({
      roles: ['should-not-load'],
      permissions: [],
    })
    const app = buildApp({
      user: activeUser,
      loadAccess,
      permissionCodes: ['donors:read'],
      preloaded: {
        roles: ['NBTS Blood Bank Officer'],
        permissions: ['donors:read'],
      },
    })

    const res = await app.request('/protected')
    expect(res.status).toBe(200)
    expect(loadAccess).not.toHaveBeenCalled()
  })

  test('throws at factory time when no codes are provided', () => {
    expect(() => createRequirePermission([])).toThrow(
      'requirePermission requires at least one permission code',
    )
  })
})

describe('attachUserAccess', () => {
  test('loads roles and permissions onto context', async () => {
    const loadAccess = createAccessMock({
      roles: ['Authorized Manager'],
      permissions: ['alerts:read', 'reports:read'],
    })
    const app = buildApp({ user: activeUser, loadAccess })

    const res = await app.request('/me-access')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      roles: string[]
      permissions: string[]
    }
    expect(body.roles).toEqual(['Authorized Manager'])
    expect(body.permissions).toEqual(['alerts:read', 'reports:read'])
  })

  test('returns 401 without authenticated user', async () => {
    const loadAccess = createAccessMock({ roles: [], permissions: [] })
    const app = buildApp({ user: null, loadAccess })

    const res = await app.request('/me-access')
    expect(res.status).toBe(401)
  })

  test('does not re-query when access already attached', async () => {
    const loadAccess = createAccessMock({
      roles: ['fresh'],
      permissions: ['fresh:code'],
    })
    const app = buildApp({
      user: activeUser,
      loadAccess,
      preloaded: {
        roles: ['cached-role'],
        permissions: ['cached:perm'],
      },
    })

    const res = await app.request('/me-access')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      roles: string[]
      permissions: string[]
    }
    expect(body.roles).toEqual(['cached-role'])
    expect(body.permissions).toEqual(['cached:perm'])
    expect(loadAccess).not.toHaveBeenCalled()
  })
})

describe('AppError.forbidden shape', () => {
  test('FORBIDDEN maps to 403', () => {
    const err = AppError.forbidden('Insufficient permissions')
    expect(err.status).toBe(403)
    expect(err.code).toBe(ErrorCodes.FORBIDDEN)
  })
})
