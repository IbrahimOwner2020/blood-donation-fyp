/**
 * Public donation chat orchestration — session + AI-service call.
 */

import { getEnv, type AppEnv } from '../../lib/env'
import { AppError, ErrorCodes } from '../../lib/errors'
import { logWarn } from '../../lib/logger'
import {
  createAiClient,
  type AiServiceClient,
  type PublicChatRequest,
} from '../../services/ai'
import type { PublicChatMessage } from './schemas'
import {
  publicChatToolSessionStore,
  type PublicChatToolSession,
} from './tool-session-store'

export type PublicChatResult = {
  answer: string
  source: 'assistant'
  disclaimer: string
}

export type HandlePublicChatOptions = {
  aiClient?: Pick<AiServiceClient, 'publicChat'>
  toolSession?: PublicChatToolSession
  toolsUrl?: string
  env?: AppEnv
  requestTimeoutMs?: number
}

function disclaimerFor(language: 'en' | 'sw' | undefined): string {
  return language === 'sw'
    ? 'Hii si ruhusa ya kitabibu. Uchunguzi wa mhudumu unahitajika kabla ya kuchangia.'
    : 'This is not medical clearance. Staff screening is required before donation.'
}

export async function handlePublicChatMessage(
  body: PublicChatMessage,
  options: HandlePublicChatOptions = {},
): Promise<PublicChatResult> {
  const env = options.env ?? getEnv()
  const timeoutMs =
    options.requestTimeoutMs ??
    Math.min(env.AI_REQUEST_TIMEOUT_MS ?? 30_000, 60_000)
  const toolSession =
    options.toolSession ??
    publicChatToolSessionStore.create({ requestId: null })
  const toolsUrl =
    options.toolsUrl ??
    `${(env.API_INTERNAL_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')}/api/v1/public/chat/tools`

  const payload: PublicChatRequest = {
    message: body.message,
    turns: body.turns ?? [],
    toolSessionToken: toolSession.token,
    toolsUrl,
  }
  if (body.language) {
    payload.language = body.language
  }

  const ai =
    options.aiClient ??
    createAiClient(env, { requestTimeoutMs: timeoutMs })

  try {
    const result = await ai.publicChat(payload)
    return {
      answer: result.answer,
      source: 'assistant',
      disclaimer: disclaimerFor(body.language),
    }
  } catch (error) {
    if (AppError.isAppError(error) && error.code === ErrorCodes.PUBLIC_CHAT_UNAVAILABLE) {
      throw error
    }
    const reason = AppError.isAppError(error)
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Public chat failed'
    logWarn('Public chat unavailable', { reason })
    throw AppError.publicChatUnavailable(
      'The donation assistant is temporarily unavailable. Please try again shortly.',
      error,
    )
  }
}
