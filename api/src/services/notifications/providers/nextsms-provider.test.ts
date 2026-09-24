import { describe, expect, mock, test } from 'bun:test'

import { NextSmsProvider } from './nextsms-provider'

const config = {
  baseUrl: 'https://messaging-service.co.tz/api/sms/v1/text/single',
  apiKey: 'key',
  apiSecret: 'secret',
  senderId: 'BDMS',
}

describe('NextSmsProvider', () => {
  test('normalizes Tanzanian phones and uses Basic authentication', async () => {
    const request = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: `Basic ${btoa('key:secret')}`,
      })
      expect(JSON.parse(String(init?.body))).toEqual({
        from: 'BDMS',
        to: '255712345678',
        text: 'Please donate',
      })
      return new Response(JSON.stringify({ messageId: 'sms-123' }), { status: 200 })
    })
    const provider = new NextSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({ channel: 'SMS', to: '0712345678', body: 'Please donate' })
    expect(result.status).toBe('SENT')
    expect(result.providerMessageId).toBe('sms-123')
  })

  test('returns a sanitized provider rejection without exposing the recipient', async () => {
    const request = mock(async () => new Response('invalid recipient +255712345678', { status: 400 }))
    const provider = new NextSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({ channel: 'SMS', to: '+255712345678', body: 'Hello' })
    expect(result.status).toBe('FAILED')
    expect(result.error).toBe('NextSMS rejected the message (400)')
    expect(result.error).not.toContain('0712345678')
  })
})
