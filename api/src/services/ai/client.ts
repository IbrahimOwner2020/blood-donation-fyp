/**
 * HTTP client for the chat-only Python assistant service.
 */

import { AppError, ErrorCodes } from '../../lib/errors'
import { getEnv, type AppEnv } from '../../lib/env'
import { logError, logWarn } from '../../lib/logger'
import type {
  AiFetch,
  AiHealthCheckResult,
  AiHealthResponse,
  AssistantChatRequest,
  AssistantChatResponse,
  PublicChatRequest,
  PublicChatResponse,
} from './types'

export type AiClientOptions = {
  baseUrl?: string
  requestTimeoutMs?: number
  healthTimeoutMs?: number
  fetch?: AiFetch
}

type JsonRequestInit = {
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  timeoutMs: number
  operation: string
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAiErrorPayload(body: unknown): { code: string; message: string } | undefined {
  if (!isRecord(body)) {
    return undefined
  }
  const error = body.error
  if (!isRecord(error)) {
    return undefined
  }
  const code = typeof error.code === 'string' ? error.code : undefined
  const message = typeof error.message === 'string' ? error.message : undefined
  if (!code && !message) {
    return undefined
  }
  return {
    code: code ?? 'AI_SERVICE_ERROR',
    message: message ?? 'AI service returned an error',
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const name = 'name' in error ? String((error as { name?: unknown }).name ?? '') : ''
  return name === 'AbortError' || name === 'TimeoutError'
}

function mapHttpStatusToAppError(
  status: number,
  aiCode: string,
  message: string,
  cause?: unknown,
): AppError {
  if (status === 404 || aiCode === 'MODEL_NOT_FOUND') {
    return new AppError(message, {
      code: ErrorCodes.NOT_FOUND,
      status: 404,
      details: [{ code: aiCode, message }],
      cause,
    })
  }

  if (status === 422 || aiCode === 'VALIDATION_ERROR' || aiCode === 'INSUFFICIENT_HISTORY') {
    return new AppError(message, {
      code:
        aiCode === 'VALIDATION_ERROR'
          ? ErrorCodes.VALIDATION_ERROR
          : ErrorCodes.BAD_REQUEST,
      status: status === 422 ? 422 : 400,
      details: [{ code: aiCode, message }],
      cause,
    })
  }

  if (status >= 400 && status < 500) {
    return new AppError(message, {
      code: ErrorCodes.BAD_REQUEST,
      status: 400,
      details: [{ code: aiCode, message }],
      cause,
    })
  }

  return new AppError(message || 'AI service failed', {
    code: ErrorCodes.INTERNAL_ERROR,
    status: 503,
    details: [{ code: aiCode || 'AI_SERVICE_ERROR', message }],
    cause,
  })
}

export class AiServiceClient {
  readonly baseUrl: string
  readonly requestTimeoutMs: number
  readonly healthTimeoutMs: number
  private readonly fetchImpl: AiFetch

  constructor(options: AiClientOptions = {}) {
    const env = getEnv()
    this.baseUrl = trimTrailingSlash(
      options.baseUrl?.trim() || env.AI_SERVICE_URL || 'http://localhost:8000',
    )
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? env.AI_REQUEST_TIMEOUT_MS ?? 30_000
    this.healthTimeoutMs =
      options.healthTimeoutMs ?? env.AI_HEALTH_TIMEOUT_MS ?? 5_000
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  /**
   * Probe AI `/health`. Never throws — returns a degraded result on failure
   * so API health aggregation can stay up when AI is down.
   */
  async health(): Promise<AiHealthCheckResult> {
    try {
      const data = await this.requestJson<AiHealthResponse>({
        method: 'GET',
        path: '/health',
        timeoutMs: this.healthTimeoutMs,
        operation: 'health',
      })
      const status = data?.status?.trim() || 'unknown'
      const payload: AiHealthResponse = {
        service: data?.service?.trim() || 'ai-service',
        status,
      }

      if (status === 'ok') {
        return { ok: true, degraded: false, data: payload }
      }

      logWarn('AI service reported non-ok health status', {
        status,
        service: payload.service,
        baseUrl: this.baseUrl,
      })

      return {
        ok: false,
        degraded: true,
        reason: `AI service status is "${status}"`,
        aiErrorCode: 'AI_HEALTH_DEGRADED',
      }
    } catch (error) {
      const reason =
        AppError.isAppError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : 'AI service health check failed'

      logWarn('AI service health check degraded', {
        reason,
        baseUrl: this.baseUrl,
      })

      return {
        ok: false,
        degraded: true,
        reason,
        statusCode: AppError.isAppError(error) ? error.status : undefined,
        aiErrorCode: AppError.isAppError(error)
          ? error.details?.[0]?.code
          : 'AI_SERVICE_UNAVAILABLE',
      }
    }
  }

  async chat(request: AssistantChatRequest): Promise<AssistantChatResponse> {
    return this.requestJson<AssistantChatResponse>({
      method: 'POST',
      path: '/chat',
      body: request,
      timeoutMs: this.requestTimeoutMs,
      operation: 'chat',
    })
  }

  async publicChat(request: PublicChatRequest): Promise<PublicChatResponse> {
    try {
      const payload = await this.requestJson<PublicChatResponse>({
        method: 'POST',
        path: '/public-chat',
        body: request,
        timeoutMs: this.requestTimeoutMs,
        operation: 'public chat',
      })
      const answer = typeof payload?.answer === 'string' ? payload.answer.trim() : ''
      if (!answer) {
        throw AppError.publicChatUnavailable(
          'The donation assistant returned an empty answer.',
        )
      }
      return { answer }
    } catch (error) {
      if (AppError.isAppError(error) && error.code === ErrorCodes.PUBLIC_CHAT_UNAVAILABLE) {
        throw error
      }
      const reason = AppError.isAppError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Public chat failed'
      logWarn('Public chat unavailable', {
        reason,
        baseUrl: this.baseUrl,
      })
      throw AppError.publicChatUnavailable(
        'The donation assistant is temporarily unavailable. Please try again shortly.',
        error,
      )
    }
  }

  private async requestJson<T>(init: JsonRequestInit): Promise<T> {
    const url = `${this.baseUrl}${init.path.startsWith('/') ? init.path : `/${init.path}`}`
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, init.timeoutMs)

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      }
      if (init.body !== undefined) {
        headers['Content-Type'] = 'application/json'
      }

      const response = await this.fetchImpl(url, {
        method: init.method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      })

      const rawText = await response.text().catch(() => '')
      let parsed: unknown = null
      if (rawText?.trim()) {
        try {
          parsed = JSON.parse(rawText) as unknown
        } catch (cause) {
          logError({
            message: 'AI service returned non-JSON body',
            meta: {
              operation: init.operation,
              status: response.status,
              path: init.path,
            },
            error: cause,
          })
          throw new AppError('AI service returned invalid JSON', {
            code: ErrorCodes.INTERNAL_ERROR,
            status: 502,
            details: [
              {
                code: 'AI_INVALID_RESPONSE',
                message: 'Response body was not valid JSON',
              },
            ],
            cause,
          })
        }
      }

      if (!response.ok) {
        const aiError = parseAiErrorPayload(parsed)
        const code = aiError?.code ?? 'AI_SERVICE_ERROR'
        const message =
          aiError?.message ??
          `AI service ${init.operation} failed with HTTP ${response.status}`

        logWarn('AI service error response', {
          operation: init.operation,
          status: response.status,
          aiCode: code,
          path: init.path,
        })

        throw mapHttpStatusToAppError(response.status, code, message)
      }

      return (parsed ?? {}) as T
    } catch (error) {
      if (AppError.isAppError(error)) {
        throw error
      }

      if (isAbortError(error)) {
        const message = `AI service ${init.operation} timed out after ${init.timeoutMs}ms`
        logError({
          message,
          meta: {
            operation: init.operation,
            timeoutMs: init.timeoutMs,
            path: init.path,
            baseUrl: this.baseUrl,
          },
          error,
        })
        throw new AppError(message, {
          code: ErrorCodes.INTERNAL_ERROR,
          status: 504,
          details: [
            {
              code: 'AI_TIMEOUT',
              message,
            },
          ],
          cause: error,
        })
      }

      const message = `AI service ${init.operation} is unreachable`
      logError({
        message,
        meta: {
          operation: init.operation,
          path: init.path,
          baseUrl: this.baseUrl,
        },
        error,
      })
      throw new AppError(message, {
        code: ErrorCodes.INTERNAL_ERROR,
        status: 503,
        details: [
          {
            code: 'AI_SERVICE_UNAVAILABLE',
            message:
              error instanceof Error
                ? error.message
                : 'Network error talking to AI service',
          },
        ],
        cause: error,
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Factory using parsed AppEnv (docs/15). */
export function createAiClient(
  env: AppEnv = getEnv(),
  options: Omit<AiClientOptions, 'baseUrl' | 'requestTimeoutMs' | 'healthTimeoutMs'> &
    Partial<
      Pick<
        AiClientOptions,
        'baseUrl' | 'requestTimeoutMs' | 'healthTimeoutMs'
      >
    > = {},
): AiServiceClient {
  return new AiServiceClient({
    baseUrl: options.baseUrl ?? env.AI_SERVICE_URL,
    requestTimeoutMs: options.requestTimeoutMs ?? env.AI_REQUEST_TIMEOUT_MS,
    healthTimeoutMs: options.healthTimeoutMs ?? env.AI_HEALTH_TIMEOUT_MS,
    fetch: options.fetch,
  })
}
