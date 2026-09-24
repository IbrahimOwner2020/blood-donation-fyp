import type {
  NotificationInput,
  NotificationProvider,
  NotificationResult,
} from '../types'
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
      return { success: false, status: 'FAILED', provider: this.id, error: 'NextSMS only supports SMS' }
    }

    const body = input.body.trim()
    const normalized = normalizeTanzanianPhone(input.to)
    if (!body || !normalized) {
      return { success: false, status: 'FAILED', provider: this.id, error: !body ? 'Missing SMS body' : 'Invalid Tanzanian SMS destination' }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000)
    const destination = toNextSmsPhone(normalized)
    try {
      const response = await this.request(this.config.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${this.config.apiKey}:${this.config.apiSecret}`)}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ from: this.config.senderId, to: destination, text: body }),
        signal: controller.signal,
      })
      const raw = await response.text()
      let payload: Record<string, unknown> = {}
      try { payload = JSON.parse(raw) as Record<string, unknown> } catch { /* provider may return plain text */ }
      if (!response.ok) {
        const error = `NextSMS rejected the message (${response.status})`
        this.log(`[${this.id}] FAILED to=${redactPhone(normalized)} status=${response.status}`)
        return { success: false, status: 'FAILED', provider: this.id, error }
      }
      const providerMessageId = [payload.messageId, payload.message_id, payload.id]
        .find((value) => typeof value === 'string' || typeof value === 'number')
      const sentAt = new Date().toISOString()
      this.log(`[${this.id}] SENT to=${redactPhone(normalized)}`)
      return {
        success: true,
        status: 'SENT',
        provider: this.id,
        providerMessageId: providerMessageId === undefined ? undefined : String(providerMessageId),
        sentAt,
      }
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'AbortError'
      this.log(`[${this.id}] FAILED to=${redactPhone(normalized)} error=${timedOut ? 'timeout' : 'request failed'}`)
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
