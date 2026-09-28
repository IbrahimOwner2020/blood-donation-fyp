import type {
  NotificationInput,
  NotificationProvider,
  NotificationResult,
} from '../types'
import { AppError } from '../../../lib/errors'
import { normalizeTanzanianPhone, toNextSmsPhone } from '../../../modules/donors/phone'
import { redactPhone } from '../redact'

export interface NextSmsConfig {
  baseUrl: string
  apiKey: string
  apiSecret: string
  senderId: string
  timeoutMs?: number
}

type FetchLike = typeof fetch

/** Final non-delivery status names from the NextSMS delivery group. */
const FINAL_FAILURE_STATUS_NAMES = new Set([
  'EXPIRED',
  'UNDELIVERABLE',
  'DELETED',
  'SKIPPED',
  'UNKNOWN',
])

const SAFE_REFERENCE = /^[A-Za-z0-9-]{1,64}$/

interface NextSmsMessageStatus {
  groupId?: number
  groupName?: string
  id?: number
  name?: string
  description?: string
}

interface NextSmsMessage {
  to?: string
  messageId?: string | number
  status?: NextSmsMessageStatus
  smsCount?: number
}

interface NextSmsSendPayload {
  messages?: NextSmsMessage[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSendPayload(raw: string): NextSmsSendPayload {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    const messagesRaw = parsed.messages
    if (!Array.isArray(messagesRaw)) return {}
    const messages: NextSmsMessage[] = []
    for (const item of messagesRaw) {
      if (!isRecord(item)) continue
      const statusRaw = item.status
      const status: NextSmsMessageStatus | undefined = isRecord(statusRaw)
        ? {
            groupId: typeof statusRaw.groupId === 'number' ? statusRaw.groupId : undefined,
            groupName:
              typeof statusRaw.groupName === 'string' ? statusRaw.groupName : undefined,
            id: typeof statusRaw.id === 'number' ? statusRaw.id : undefined,
            name: typeof statusRaw.name === 'string' ? statusRaw.name : undefined,
            description:
              typeof statusRaw.description === 'string'
                ? statusRaw.description
                : undefined,
          }
        : undefined
      messages.push({
        to: typeof item.to === 'string' ? item.to : undefined,
        messageId:
          typeof item.messageId === 'string' || typeof item.messageId === 'number'
            ? item.messageId
            : undefined,
        status,
        smsCount: typeof item.smsCount === 'number' ? item.smsCount : undefined,
      })
    }
    return { messages }
  } catch {
    return {}
  }
}

function referenceFromMetadata(
  metadata: Record<string, string> | undefined,
): string | undefined {
  const value = metadata?.notificationId?.trim()
  if (!value || !SAFE_REFERENCE.test(value)) return undefined
  return value
}

function classifyMessageStatus(
  status: NextSmsMessageStatus | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!status?.groupName && !status?.name) {
    return { ok: false, error: 'NextSMS response missing message status' }
  }

  const groupName = (status.groupName ?? '').toUpperCase()
  const name = (status.name ?? '').toUpperCase()

  if (groupName === 'PENDING' || groupName === 'DELIVERED') {
    return { ok: true }
  }

  if (
    groupName === 'REJECTED' ||
    name.startsWith('REJECTED_') ||
    FINAL_FAILURE_STATUS_NAMES.has(name)
  ) {
    const label = name || groupName || 'REJECTED'
    return { ok: false, error: `NextSMS ${label}` }
  }

  return {
    ok: false,
    error: `NextSMS ${name || groupName || 'UNKNOWN'}`,
  }
}

export class NextSmsProvider implements NotificationProvider {
  readonly id = 'nextsms'

  constructor(
    private readonly config: NextSmsConfig,
    private readonly request: FetchLike = fetch,
    private readonly log: (message: string) => void = console.info,
  ) {
    if (!config.apiKey || !config.apiSecret || !config.senderId) {
      throw new Error('NextSMS credentials and registered sender ID are required')
    }
  }

  async send(input: NotificationInput): Promise<NotificationResult> {
    if (input.channel !== 'SMS') {
      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: 'NextSMS only supports SMS',
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
    const reference = referenceFromMetadata(input.metadata)
    const requestBody: Record<string, string> = {
      from: this.config.senderId,
      to: destination,
      text: body,
    }
    if (reference) {
      requestBody.reference = reference
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
        const error = `NextSMS rejected the message (${response.status})`
        this.log(`[${this.id}] FAILED to=${redactPhone(normalized)} status=${response.status}`)
        return { success: false, status: 'FAILED', provider: this.id, error }
      }

      const message = payload.messages?.[0]
      const classified = classifyMessageStatus(message?.status)
      if (!classified.ok) {
        this.log(
          `[${this.id}] FAILED to=${redactPhone(normalized)} error=${classified.error}`,
        )
        return {
          success: false,
          status: 'FAILED',
          provider: this.id,
          error: classified.error,
          providerMessageId:
            message?.messageId === undefined ? undefined : String(message.messageId),
        }
      }

      const sentAt = new Date().toISOString()
      this.log(`[${this.id}] SENT to=${redactPhone(normalized)}`)
      return {
        success: true,
        status: 'SENT',
        provider: this.id,
        providerMessageId:
          message?.messageId === undefined ? undefined : String(message.messageId),
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
          ? 'NextSMS delivery result is unknown after timeout; do not retry automatically'
          : 'NextSMS request failed',
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
