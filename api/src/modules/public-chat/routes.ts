/**
 * Anonymous public donation education chatbot.
 * LLM answers via AI service; tools are API-owned and bearer-protected.
 */

import type { Context } from 'hono'
import { Hono } from 'hono'

import { getDb } from '../../db'
import { getEnv } from '../../lib/env'
import { AppError } from '../../lib/errors'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody } from '../../lib/validate'
import { publicChatMessageSchema, publicChatToolCallSchema } from './schemas'
import { handlePublicChatMessage } from './service'
import { publicChatToolSessionStore, type PublicChatToolSession } from './tool-session-store'
import { callPublicChatTool, listPublicChatTools } from './tools'

const requests = new Map<string, number[]>()

function clientIp(c: Context<AppHonoEnv>): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  )
}

function toolBearer(c: Context<AppHonoEnv>): string {
  const header = c.req.header('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  if (!token) {
    throw AppError.unauthorized('Public chat tool session required')
  }
  return token
}

function requireToolSession(c: Context<AppHonoEnv>): PublicChatToolSession {
  const session = publicChatToolSessionStore.get(toolBearer(c))
  if (!session) {
    throw AppError.unauthorized('Public chat tool session expired')
  }
  return session
}

export const publicChatRoutes = new Hono<AppHonoEnv>()

publicChatRoutes.post('/tools/list', async (c) => {
  requireToolSession(c)
  return jsonOk(c, {
    tools: listPublicChatTools(),
  })
})

publicChatRoutes.post('/tools/call', async (c) => {
  requireToolSession(c)
  const body = await parseJsonBody(c, publicChatToolCallSchema)
  const result = await callPublicChatTool(getDb(), body.name, body.arguments ?? {})
  return jsonOk(c, {
    tool: body.name,
    result,
  })
})

publicChatRoutes.post('/', async (c) => {
  const key = clientIp(c)
  const now = Date.now()
  const recent = (requests.get(key) ?? []).filter((time) => now - time < 60_000)
  if (recent.length >= 10) {
    throw AppError.rateLimited('Please wait before sending another question.')
  }
  recent.push(now)
  requests.set(key, recent)

  const body = await parseJsonBody(c, publicChatMessageSchema)
  const env = getEnv()
  const toolSession = publicChatToolSessionStore.create({
    requestId: c.get('requestId') ?? null,
  })
  const origin = new URL(c.req.url).origin
  const toolsOrigin = env.API_INTERNAL_BASE_URL ?? origin
  const toolsUrl = `${toolsOrigin.replace(/\/+$/, '')}/api/v1/public/chat/tools`
  const timeoutMs = Math.min(env.AI_REQUEST_TIMEOUT_MS ?? 30_000, 60_000)

  const result = await handlePublicChatMessage(body, {
    env,
    toolSession,
    toolsUrl,
    requestTimeoutMs: timeoutMs,
  })
  return jsonOk(c, result)
})
