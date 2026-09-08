/**
 * Minimal requireAuth — validates HTTP-only session cookie against DB sessions.
 * Permission checks: use requirePermission / attachUserAccess from require-permission.
 */

import { createMiddleware } from 'hono/factory'

import { getDb } from '../db'
import { AppError } from '../lib/errors'
import type { AppHonoEnv } from '../lib/types'
import { readSessionId } from '../modules/auth/cookies'
import { findValidSession } from '../modules/auth/sessions'

/**
 * Ensures the request has a valid, non-expired session for an ACTIVE user.
 * Sets `user` and `sessionId` on the Hono context.
 */
export const requireAuth = createMiddleware<AppHonoEnv>(async (c, next) => {
  const sessionId = readSessionId(c)
  if (!sessionId) {
    throw AppError.unauthorized('Authentication required')
  }

  const validated = await findValidSession(getDb(), sessionId)
  if (!validated?.user) {
    throw AppError.unauthorized('Authentication required')
  }

  c.set('user', validated.user)
  c.set('sessionId', validated.session.id)
  await next()
})
