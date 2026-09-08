import type {
  NotificationInput,
  NotificationProvider,
  NotificationResult,
} from '../types'
import { redactPhone } from '../redact'

export interface MockSmsRecord {
  toRedacted: string
  body: string
  metadata?: Record<string, string>
  recordedAt: string
  providerMessageId: string
}

export interface MockSmsProviderOptions {
  /** Optional sink for recorded mock sends (tests / future dev inbox). */
  records?: MockSmsRecord[]
  /** Override clock for deterministic tests. */
  now?: () => Date
  /** Override logger; defaults to console.info with redacted destination. */
  log?: (message: string) => void
}

/**
 * Development/test SMS provider — never calls a real SMS gateway.
 * Stores simulated sends in memory and logs redacted destinations only.
 */
export class MockSmsProvider implements NotificationProvider {
  readonly id = 'mock-sms'

  private readonly records: MockSmsRecord[]
  private readonly now: () => Date
  private readonly log: (message: string) => void
  private sequence = 0

  constructor(options: MockSmsProviderOptions = {}) {
    this.records = options.records ?? []
    this.now = options.now ?? (() => new Date())
    this.log = options.log ?? ((message: string) => {
      console.info(message)
    })
  }

  /** Snapshot of mock sends recorded by this provider instance. */
  getRecords(): readonly MockSmsRecord[] {
    return [...this.records]
  }

  async send(input: NotificationInput): Promise<NotificationResult> {
    const channel = input?.channel
    const to = (input?.to ?? '').trim()
    const body = (input?.body ?? '').trim()

    if (channel !== 'SMS') {
      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: 'MockSmsProvider only supports channel SMS',
      }
    }

    if (!to) {
      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: 'Missing SMS destination',
      }
    }

    if (!body) {
      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: 'Missing SMS body',
      }
    }

    const sentAtDate = this.now()
    const sentAt = sentAtDate.toISOString()
    this.sequence += 1
    const providerMessageId = `mock-sms-${sentAtDate.getTime()}-${this.sequence}`
    const toRedacted = redactPhone(to)

    const record: MockSmsRecord = {
      toRedacted,
      body,
      metadata: input?.metadata,
      recordedAt: sentAt,
      providerMessageId,
    }
    this.records.push(record)

    this.log(
      `[${this.id}] SENT to=${toRedacted} id=${providerMessageId} chars=${body.length}`,
    )

    return {
      success: true,
      status: 'SENT',
      provider: this.id,
      providerMessageId,
      sentAt,
    }
  }
}
