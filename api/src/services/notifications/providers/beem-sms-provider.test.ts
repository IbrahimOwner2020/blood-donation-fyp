import { describe, expect, mock, test } from 'bun:test'

import { BeemSmsProvider } from './beem-sms-provider'

const config = {
  baseUrl: 'https://apisms.beem.africa/v1/send',
  apiKey: 'key',
  apiSecret: 'secret',
  senderId: 'NOTTECH',
}

describe('BeemSmsProvider', () => {
  test('normalizes Tanzanian phones and sends Beem payload with Basic auth', async () => {
    const request = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(_url).toBe(config.baseUrl)
      expect(init?.headers).toMatchObject({
        Authorization: `Basic ${btoa('key:secret')}`,
        'Content-Type': 'application/json',
      })
      expect(JSON.parse(String(init?.body))).toEqual({
        source_addr: 'NOTTECH',
        encoding: '0',
        schedule_time: '',
        message: 'Please donate',
        recipients: [
          {
            recipient_id: '255712345678',
            dest_addr: '255712345678',
          },
        ],
      })
      return new Response('', { status: 200 })
    })
    const provider = new BeemSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({
      channel: 'SMS',
      to: '0712345678',
      body: 'Please donate',
    })
    expect(result.status).toBe('SENT')
    expect(result.success).toBe(true)
    expect(result.provider).toBe('beem')
    expect(result.providerMessageId).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
  })

  test('stores request_id when Beem returns a successful JSON payload', async () => {
    const request = mock(async () =>
      new Response(
        JSON.stringify({
          successful: true,
          request_id: 'req-99',
          code: 100,
          message: 'Sent Successfully',
        }),
        { status: 200 },
      ),
    )
    const provider = new BeemSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({
      channel: 'SMS',
      to: '+255712345678',
      body: 'Hello',
    })
    expect(result.status).toBe('SENT')
    expect(result.providerMessageId).toBe('req-99')
  })

  test('treats successful:false on HTTP 200 as FAILED without leaking the recipient', async () => {
    const request = mock(async () =>
      new Response(
        JSON.stringify({
          successful: false,
          code: 102,
          message: 'Insufficient balance',
        }),
        { status: 200 },
      ),
    )
    const provider = new BeemSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({
      channel: 'SMS',
      to: '+255712345678',
      body: 'Hello',
    })
    expect(result.status).toBe('FAILED')
    expect(result.error).toBe('Beem Insufficient balance')
    expect(result.error).not.toContain('712345678')
    expect(result.error).not.toContain('+255')
  })

  test('returns a sanitized provider rejection without exposing the recipient', async () => {
    const request = mock(async () => new Response('invalid recipient +255712345678', { status: 400 }))
    const provider = new BeemSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({ channel: 'SMS', to: '+255712345678', body: 'Hello' })
    expect(result.status).toBe('FAILED')
    expect(result.error).toBe('Beem rejected the message (400)')
    expect(result.error).not.toContain('0712345678')
  })

  test('returns invalid destination without calling the gateway', async () => {
    const request = mock(async () => new Response('should not be called', { status: 200 }))
    const provider = new BeemSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({
      channel: 'SMS',
      to: 'not-a-phone',
      body: 'Hello',
    })
    expect(result.status).toBe('FAILED')
    expect(result.error).toBe('Invalid Tanzanian SMS destination')
    expect(request).toHaveBeenCalledTimes(0)
  })
})
