import { describe, expect, mock, test } from 'bun:test'
import type { Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { SmtpEmailProvider } from './smtp-email-provider'
import { redactEmail } from '../redact'
import {
  createNotificationProvider,
  createSmsProvider,
  readSmtpConfigFromEnv,
} from '../create-notification-provider'
import { MockSmsProvider } from './mock-sms-provider'

type SentMessageInfo = SMTPTransport.SentMessageInfo

function createMockTransport(options: {
  messageId?: string
  failWith?: Error
} = {}): Transporter<SentMessageInfo> {
  const sendMail = mock(
    async (_mail: unknown): Promise<SentMessageInfo> => {
      if (options.failWith) {
        throw options.failWith
      }

      return {
        messageId: options.messageId ?? '<mock-message-id@localhost>',
        accepted: [],
        rejected: [],
        pending: [],
        response: '250 OK',
        envelope: { from: '', to: [] },
      } as SentMessageInfo
    },
  )

  return {
    sendMail,
  } as unknown as Transporter<SentMessageInfo>
}

describe('SmtpEmailProvider', () => {
  const baseConfig = {
    host: 'mailpit',
    port: 1025,
    from: 'no-reply@nbts.local',
  }

  test('sends email via injected transport and redacts recipient in logs', async () => {
    const logs: string[] = []
    const transport = createMockTransport({
      messageId: '<test-id@mailpit>',
    })
    const provider = new SmtpEmailProvider({
      config: baseConfig,
      transport,
      now: () => new Date('2026-09-02T10:00:00.000Z'),
      log: (message) => {
        logs.push(message)
      },
    })

    const email = 'donor.jane@example.com'
    const result = await provider.send({
      channel: 'EMAIL',
      to: email,
      subject: 'Blood donation request',
      body: 'Please consider donating O+ this week.',
    })

    expect(result.success).toBe(true)
    expect(result.status).toBe('SENT')
    expect(result.provider).toBe('smtp-email')
    expect(result.providerMessageId).toBe('<test-id@mailpit>')
    expect(result.sentAt).toBe('2026-09-02T10:00:00.000Z')

    expect(transport.sendMail).toHaveBeenCalledTimes(1)
    const mailArg = (
      transport.sendMail as ReturnType<typeof mock>
    ).mock.calls[0]?.[0] as {
      from?: string
      to?: string
      subject?: string
      text?: string
    }
    expect(mailArg?.from).toBe(baseConfig.from)
    expect(mailArg?.to).toBe(email)
    expect(mailArg?.subject).toBe('Blood donation request')
    expect(mailArg?.text).toContain('O+')

    expect(logs[0]).toContain(redactEmail(email))
    expect(logs[0]).not.toContain(email)
  })

  test('returns FAILED when transport throws, with sanitized error', async () => {
    const logs: string[] = []
    const transport = createMockTransport({
      failWith: new Error('Relay rejected donor.jane@example.com'),
    })
    const provider = new SmtpEmailProvider({
      config: baseConfig,
      transport,
      log: (message) => {
        logs.push(message)
      },
    })

    const result = await provider.send({
      channel: 'EMAIL',
      to: 'donor.jane@example.com',
      body: 'Hello',
    })

    expect(result.success).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.error).toContain('***@***')
    expect(result.error).not.toContain('donor.jane@example.com')
    expect(logs[0]).toContain('FAILED')
    expect(logs[0]).not.toContain('donor.jane@example.com')
  })

  test('rejects non-EMAIL channel', async () => {
    const provider = new SmtpEmailProvider({
      config: baseConfig,
      transport: createMockTransport(),
      log: () => {},
    })

    const result = await provider.send({
      channel: 'SMS',
      to: 'donor@example.com',
      body: 'nope',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('EMAIL')
  })
})

describe('createNotificationProvider factory', () => {
  test('createSmsProvider defaults to MockSmsProvider', () => {
    const provider = createSmsProvider({ SMS_PROVIDER: 'mock' })
    expect(provider).toBeInstanceOf(MockSmsProvider)
    expect(provider.id).toBe('mock-sms')
  })

  test('createSmsProvider throws on unknown SMS_PROVIDER', () => {
    expect(() => createSmsProvider({ SMS_PROVIDER: 'twilio' })).toThrow(
      /Unsupported SMS_PROVIDER/,
    )
  })

  test('readSmtpConfigFromEnv applies Mailpit defaults', () => {
    const config = readSmtpConfigFromEnv({})
    expect(config.host).toBe('localhost')
    expect(config.port).toBe(1025)
    expect(config.from).toBe('no-reply@nbts.local')
    expect(config.secure).toBe(false)
  })

  test('createNotificationProvider selects by channel', () => {
    const sms = createNotificationProvider('SMS', { SMS_PROVIDER: 'mock' })
    expect(sms.id).toBe('mock-sms')

    const email = createNotificationProvider('EMAIL', {
      SMTP_HOST: 'mailpit',
      SMTP_PORT: '1025',
      SMTP_FROM: 'no-reply@nbts.local',
    })
    expect(email.id).toBe('smtp-email')
  })
})
