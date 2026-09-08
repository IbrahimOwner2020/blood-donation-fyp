import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import type {
  NotificationInput,
  NotificationProvider,
  NotificationResult,
} from '../types'
import { redactEmail } from '../redact'

export interface SmtpEmailConfig {
  host: string
  port: number
  from: string
  /** Optional SMTP auth — unused for local Mailpit. */
  user?: string
  pass?: string
  secure?: boolean
}

export interface SmtpEmailProviderOptions {
  config: SmtpEmailConfig
  /** Injected transport for unit tests (avoids real SMTP). */
  transport?: Transporter<SMTPTransport.SentMessageInfo>
  now?: () => Date
  log?: (message: string) => void
}

/**
 * SMTP email provider compatible with Mailpit (and standard SMTP relays).
 * Uses env-backed config; never logs full recipient addresses.
 */
export class SmtpEmailProvider implements NotificationProvider {
  readonly id = 'smtp-email'

  private readonly config: SmtpEmailConfig
  private readonly transport: Transporter<SMTPTransport.SentMessageInfo>
  private readonly now: () => Date
  private readonly log: (message: string) => void

  constructor(options: SmtpEmailProviderOptions) {
    const config = options?.config
    if (!config?.host || !config?.from) {
      throw new Error('SmtpEmailProvider requires config.host and config.from')
    }

    const port = Number(config.port)
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error('SmtpEmailProvider requires a valid config.port')
    }

    this.config = {
      host: config.host,
      port,
      from: config.from,
      user: config.user,
      pass: config.pass,
      secure: config.secure ?? false,
    }
    this.now = options.now ?? (() => new Date())
    this.log = options.log ?? ((message: string) => {
      console.info(message)
    })

    this.transport =
      options.transport ??
      nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure ?? false,
        auth:
          this.config.user && this.config.pass
            ? {
                user: this.config.user,
                pass: this.config.pass,
              }
            : undefined,
      })
  }

  async send(input: NotificationInput): Promise<NotificationResult> {
    const channel = input?.channel
    const to = (input?.to ?? '').trim()
    const body = (input?.body ?? '').trim()
    const subject = (input?.subject ?? '').trim() || 'NBTS notification'
    const toRedacted = redactEmail(to)

    if (channel !== 'EMAIL') {
      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: 'SmtpEmailProvider only supports channel EMAIL',
      }
    }

    if (!to) {
      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: 'Missing email destination',
      }
    }

    if (!body) {
      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: 'Missing email body',
      }
    }

    try {
      const info = await this.transport.sendMail({
        from: this.config.from,
        to,
        subject,
        text: body,
      })

      const sentAt = this.now().toISOString()
      const providerMessageId =
        typeof info?.messageId === 'string' && info.messageId.length > 0
          ? info.messageId
          : `smtp-${Date.now()}`

      this.log(
        `[${this.id}] SENT to=${toRedacted} id=${providerMessageId}`,
      )

      return {
        success: true,
        status: 'SENT',
        provider: this.id,
        providerMessageId,
        sentAt,
      }
    } catch (err: unknown) {
      const safeMessage = sanitizeProviderError(err)
      this.log(`[${this.id}] FAILED to=${toRedacted} error=${safeMessage}`)

      return {
        success: false,
        status: 'FAILED',
        provider: this.id,
        error: safeMessage,
      }
    }
  }
}

/**
 * Builds a short error string without echoing recipient addresses from nodemailer.
 */
function sanitizeProviderError(err: unknown): string {
  if (err instanceof Error) {
    const message = (err.message ?? '').trim() || 'SMTP send failed'
    // Strip common email-like tokens if the transport embeds them.
    return message.replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      '***@***',
    )
  }

  return 'SMTP send failed'
}
