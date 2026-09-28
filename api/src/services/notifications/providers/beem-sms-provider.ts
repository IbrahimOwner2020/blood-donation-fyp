import type {
  NotificationInput,
  NotificationProvider,
  NotificationResult,
} from '../types'
import { AppError } from '../../../lib/errors'
import { normalizeTanzanianPhone, toNextSmsPhone } from '../../../modules/donors/phone'
import { redactPhone } from '../redact'

export interface BeemSmsConfig {
  baseUrl: string
  apiKey: string
  apiSecret: string
  senderId: string
  timeoutMs?: number
}

type FetchLike = typeof fetch

interface BeemSendPayload {
  successful?: boolean
  code?: number | string
  message?: string
  request_id?: string | number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSendPayload(raw: string): BeemSendPayload | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isRecord(parsed)) return {}
    return {
      successful: typeof parsed.successful === 'boolean' ? parsed.successful : undefined,
      code:
        typeof parsed.code === 'number' || typeof parsed.code === 'string'
          ? parsed.code
          : undefined,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
      request_id:
        typeof parsed.request_id === 'string' || typeof parsed.request_id === 'number'
          ? parsed.request_id
          : undefined,
    }
  } catch {
    return {}
  }
}

function classifyPayload(
  payload: BeemSendPayload | null,
): { ok: true; providerMessageId?: string } | { ok: false; error: string } {
  if (payload === null) {
    return { ok: true }
  }

  const codeRaw = payload.code
  const code =
    typeof codeRaw === 'number'
      ? codeRaw
      : typeof codeRaw === 'string' && codeRaw.trim() !== ''
        ? Number(codeRaw)
        : undefined

  if (payload.successful === false) {
    const label =
      typeof payload.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : code !== undefined && Number.isFinite(code)
          ? `code ${code}`
          : 'request rejected'
    return { ok: false, error: `Beem ${label}` }
  }

  if (code !== undefined && Number.isFinite(code) && code !== 100) {
    const label =
      typeof payload.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : `code ${code}`
    return { ok: false, error: `Beem ${label}` }
  }

  return {
    ok: true,
    providerMessageId:
      payload.request_id === undefined ? undefined : String(payload.request_id),
  }
}

export class BeemSmsProvider implements NotificationProvider {
  readonly id = 'beem'

  constructor(
    private readonly config: BeemSmsConfig,
    private readonly request: FetchLike = fetch,
    private readonly log: (message: string) => void = console.info,
  ) {
    if (!config.apiKey || !config.apiSecret || !config.senderId) {
      throw new Error('Beem credentials and registered sender ID are required')
    }
  }

  async send(input: NotificationInput): Promise<NotificationResult> {
    if (input.channel !== 'SMS') {
      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: 'Beem only supports SMS',
      }
    }

    const body = input.body.trim()
    if (!body) {
      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: 'Missing SMS body',
      }
    }

    let normalized: string
    try {
      normalized = normalizeTanzanianPhone(input.to)
    } catch (error) {
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') {
        return {
          success: false,
          status: 'FAILED',
          provider: this.id,
          error: 'Invalid Tanzanian SMS destination',
        }
      }
      throw error
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000)
    const destination = toNextSmsPhone(normalized)
    const requestBody = {
      source_addr: this.config.senderId,
      encoding: '0',
      schedule_time: '',
      message: body,
      recipients: [
        {
          recipient_id: destination,
          dest_addr: destination,
        },
      ],
    }

    try {
      const response = await this.request(this.config.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${this.config.apiKey}:${this.config.apiSecret}`)}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
      const raw = await response.text()
      const payload = parseSendPayload(raw)

      if (!response.ok) {
        const error = `Beem rejected the message (${response.status})`
        this.log(`[${this.id}] FAILED to=${redactPhone(normalized)} status=${response.status}`)
        return { success: false, status: 'FAILED', provider: this.id, error }
      }

      const classified = classifyPayload(payload)
      if (!classified.ok) {
        this.log(`[${this.id}] FAILED to=${redactPhone(normalized)} error=${classified.error}`)
        return {
          success: false,
          status: 'FAILED',
          provider: this.id,
          error: classified.error,
        }
      }

      const sentAt = new Date().toISOString()
      this.log(`[${this.id}] SENT to=${redactPhone(normalized)}`)
      return {
        success: true,
        status: 'SENT',
        provider: this.id,
        providerMessageId: classified.providerMessageId,
        sentAt,
      }
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'AbortError'
      this.log(
        `[${this.id}] FAILED to=${redactPhone(normalized)} error=${timedOut ? 'timeout' : 'request failed'}`,
      )
      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: timedOut
          ? 'Beem delivery result is unknown after timeout; do not retry automatically'
          : 'Beem request failed',
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
