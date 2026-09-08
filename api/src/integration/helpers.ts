/**
 * Shared helpers for API integration tests (Hono app.request + live MariaDB).
 * Soft-skip when DB/seed/demo users are unavailable.
 */

import { app } from '../index'
import { createDb, closeDb } from '../db'
import { SESSION_COOKIE_NAME } from '../modules/auth/constants'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type ApiDataEnvelope<T> = {
  data: T
  error: null
}

export type ApiErrorEnvelope = {
  data: null
  error: {
    code: string
    message: string
    details?: Array<{ path?: string; message: string; code?: string }>
  }
}

export type ApiEnvelope<T> = ApiDataEnvelope<T> | ApiErrorEnvelope

const adminEmail =
  Bun.env.DEMO_ADMIN_EMAIL?.trim() ||
  process.env.DEMO_ADMIN_EMAIL?.trim() ||
  'admin@nbts.local'

const adminPassword =
  Bun.env.DEMO_ADMIN_PASSWORD?.trim() ||
  process.env.DEMO_ADMIN_PASSWORD?.trim() ||
  'ChangeMe-Admin-Local-Only!'

let dbReady: boolean | null = null

/** Probe MariaDB via a lightweight query; caches result for the process. */
export async function isIntegrationDbReady(): Promise<boolean> {
  if (dbReady !== null) {
    return dbReady
  }
  try {
    const { pool } = createDb()
    try {
      const [rows] = await pool.query('SELECT 1 AS ok')
      const first = Array.isArray(rows) ? rows[0] : null
      dbReady = Boolean(
        first &&
          typeof first === 'object' &&
          first !== null &&
          'ok' in first &&
          Number((first as { ok: number }).ok) === 1,
      )
    } finally {
      await pool.end().catch(() => undefined)
    }
  } catch (error) {
    console.warn(
      '[integration] DB probe failed:',
      error instanceof Error ? error.message : String(error),
    )
    dbReady = false
  }
  return dbReady
}

export async function teardownIntegrationDb(): Promise<void> {
  await closeDb().catch(() => undefined)
}

function parseSetCookie(header: string | null): string | null {
  if (!header) {
    return null
  }
  // Bun/Hono may return a single Set-Cookie or join multiple with comma —
  // take the nbts_session pair only.
  const match = header.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;\\s,]+)`))
  return match?.[1] ? `${SESSION_COOKIE_NAME}=${match[1]}` : null
}

export function extractSessionCookie(response: Response): string | null {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.()
  if (Array.isArray(getSetCookie) && getSetCookie.length > 0) {
    for (const line of getSetCookie) {
      const cookie = parseSetCookie(line)
      if (cookie) {
        return cookie
      }
    }
  }
  return parseSetCookie(response.headers.get('set-cookie'))
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string
    cookie?: string | null
    json?: unknown
    headers?: Record<string, string>
  } = {},
): Promise<{ response: Response; body: ApiEnvelope<T> }> {
  const method = (options.method || 'GET').toUpperCase()
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  }
  if (options.cookie) {
    headers.cookie = options.cookie
  }
  let body: string | undefined
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.json)
  }

  const response = await app.request(path, {
    method,
    headers,
    body,
  })

  let parsed: ApiEnvelope<T>
  try {
    parsed = (await response.json()) as ApiEnvelope<T>
  } catch {
    parsed = {
      data: null,
      error: {
        code: 'BAD_GATEWAY',
        message: `Non-JSON response (${response.status})`,
      },
    }
  }

  return { response, body: parsed }
}

export async function loginAsDemoAdmin(): Promise<{
  cookie: string
  userId: number
} | null> {
  const { response, body } = await apiRequest<{
    user?: { id?: number }
  }>('/api/v1/auth/login', {
    method: 'POST',
    json: { email: adminEmail, password: adminPassword },
  })

  if (response.status !== 200 || !body.data?.user?.id) {
    return null
  }

  const cookie = extractSessionCookie(response)
  if (!cookie) {
    return null
  }

  return { cookie, userId: body.data.user.id }
}

/** Build ≥30 daily history points for AI min_training_rows default. */
export function buildSyntheticHistory(
  days: number = 35,
  demandUnits: number = 80,
): Array<{ date: string; demand_units: number }> {
  const points: Array<{ date: string; demand_units: number }> = []
  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end)
    d.setUTCDate(end.getUTCDate() - i)
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    points.push({
      date: `${yyyy}-${mm}-${dd}`,
      demand_units: demandUnits + (i % 5),
    })
  }
  return points
}

export function todayDateOnly(): string {
  const d = new Date()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
