/**
 * AI service HTTP contracts mirrored from docs/14-api-ai-contracts.md
 * and ai-service/app/schemas.py (read-only alignment).
 */

export interface AiHealthResponse {
  service: string
  status: string
}

/** Non-throwing health probe result for degraded API behaviour. */
export type AiHealthCheckResult =
  | {
      ok: true
      degraded: false
      data: AiHealthResponse
    }
  | {
      ok: false
      degraded: true
      reason: string
      statusCode?: number
      aiErrorCode?: string
    }

export interface AiErrorBody {
  code: string
  message: string
}

export interface AiErrorResponse {
  error: AiErrorBody
}

export type AssistantChatContext = {
  pathname?: string
  search?: string
  filters?: Record<string, unknown>
  [key: string]: unknown
}

export type AssistantChatRequest = {
  message: string
  context?: AssistantChatContext
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  permissions: string[]
  toolSessionToken: string
  toolsUrl: string
}

export type AssistantActionProposalWire = {
  id: string
  action: string
  title: string
  description: string
  requiredPermission: string
  payload: Record<string, unknown>
  effect: string
}

export type AssistantChatResponse =
  | {
      type: 'answer'
      message: string
    }
  | {
      type: 'navigation'
      message: string
      path: string
      requiredPermission?: string
    }
  | {
      type: 'permission_denied'
      message: string
      requiredPermission: string
    }
  | {
      type: 'action_proposal'
      message: string
      proposal: AssistantActionProposalWire
    }

export type PublicChatRequest = {
  message: string
  language?: 'en' | 'sw'
  turns: Array<{ role: 'user' | 'assistant'; content: string }>
  toolSessionToken: string
  toolsUrl: string
}

export type PublicChatResponse = {
  answer: string
}

export type AiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>
