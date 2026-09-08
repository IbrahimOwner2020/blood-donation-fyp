import { describe, expect, test } from 'bun:test'
import { MockSmsProvider } from './mock-sms-provider'
import { redactPhone } from '../redact'

describe('MockSmsProvider', () => {
  test('sends SMS and records a redacted destination without logging full phone', async () => {
    const logs: string[] = []
    const fixedNow = new Date('2026-09-02T09:00:00.000Z')
    const provider = new MockSmsProvider({
      now: () => fixedNow,
      log: (message) => {
        logs.push(message)
      },
    })

    const phone = '+255712345678'
    const result = await provider.send({
      channel: 'SMS',
      to: phone,
      body: 'Shortage alert: O+ needed at Centre A.',
      metadata: { alertId: 'alert-1' },
    })

    expect(result.success).toBe(true)
    expect(result.status).toBe('SENT')
    expect(result.provider).toBe('mock-sms')
    expect(result.sentAt).toBe(fixedNow.toISOString())
    expect(result.providerMessageId?.startsWith('mock-sms-')).toBe(true)

    const records = provider.getRecords()
    expect(records).toHaveLength(1)
    expect(records[0]?.toRedacted).toBe(redactPhone(phone))
    expect(records[0]?.toRedacted).not.toContain('712345678')
    expect(records[0]?.body).toContain('O+')

    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain(redactPhone(phone))
    expect(logs[0]).not.toContain(phone)
    expect(logs[0]).not.toContain('712345678')
  })

  test('rejects non-SMS channel and empty fields', async () => {
    const provider = new MockSmsProvider({
      log: () => {},
    })

    const wrongChannel = await provider.send({
      channel: 'EMAIL',
      to: '+255700000001',
      body: 'hello',
    })
    expect(wrongChannel.success).toBe(false)
    expect(wrongChannel.status).toBe('FAILED')
    expect(wrongChannel.error).toContain('SMS')

    const missingTo = await provider.send({
      channel: 'SMS',
      to: '   ',
      body: 'hello',
    })
    expect(missingTo.success).toBe(false)
    expect(missingTo.error).toContain('destination')

    const missingBody = await provider.send({
      channel: 'SMS',
      to: '+255700000001',
      body: '',
    })
    expect(missingBody.success).toBe(false)
    expect(missingBody.error).toContain('body')

    expect(provider.getRecords()).toHaveLength(0)
  })
})
