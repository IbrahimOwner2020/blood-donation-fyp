import { describe, expect, mock, test } from 'bun:test'

import { NextSmsProvider } from './nextsms-provider'

const config = {
  baseUrl: 'https://messaging-service.co.tz/api/sms/v1/text/single',
  apiKey: 'key',
  apiSecret: 'secret',
  senderId: 'BDMS',
}

const pendingEnrouteBody = {
  messages: [
    {
      to: '255712345678',
      status: {
        groupId: 1,
        groupName: 'PENDING',
        id: 7,
        name: 'PENDING_ENROUTE',
        description: 'Message sent to next instance',
      },
      smsCount: 1,
    },
  ],
}

describe('NextSmsProvider', () => {
  test('normalizes Tanzanian phones, sends reference, and accepts PENDING_ENROUTE', async () => {
    const request = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: `Basic ${btoa('key:secret')}`,
      })
      expect(JSON.parse(String(init?.body))).toEqual({
        from: 'BDMS',
        to: '255712345678',
        text: 'Please donate',
        reference: '42',
      })
      return new Response(JSON.stringify(pendingEnrouteBody), { status: 200 })
    })
    const provider = new NextSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({
      channel: 'SMS',
      to: '0712345678',
      body: 'Please donate',
      metadata: { notificationId: '42' },
    })
    expect(result.status).toBe('SENT')
    expect(result.success).toBe(true)
    expect(result.providerMessageId).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
  })

  test('stores messageId from messages[0] when the gateway includes it', async () => {
    const request = mock(async () =>
      new Response(
        JSON.stringify({
          messages: [
            {
              to: '255712345678',
              messageId: '28089492984101631440',
              status: {
                groupId: 1,
                groupName: 'PENDING',
                id: 7,
                name: 'PENDING_ENROUTE',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const provider = new NextSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({
      channel: 'SMS',
      to: '+255712345678',
      body: 'Hello',
    })
    expect(result.status).toBe('SENT')
    expect(result.providerMessageId).toBe('28089492984101631440')
  })

  test('treats REJECTED status on HTTP 200 as FAILED without leaking the recipient', async () => {
    const request = mock(async () =>
      new Response(
        JSON.stringify({
          messages: [
            {
              to: '255712345678',
              status: {
                groupId: 5,
                groupName: 'REJECTED',
                id: 12,
                name: 'REJECTED_NOT_ENOUGH_CREDITS',
                description: 'Not enough credits',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const provider = new NextSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({
      channel: 'SMS',
      to: '+255712345678',
      body: 'Hello',
    })
    expect(result.status).toBe('FAILED')
    expect(result.error).toBe('NextSMS REJECTED_NOT_ENOUGH_CREDITS')
    expect(result.error).not.toContain('712345678')
    expect(result.error).not.toContain('+255')
  })

  test('returns a sanitized provider rejection without exposing the recipient', async () => {
    const request = mock(async () => new Response('invalid recipient +255712345678', { status: 400 }))
    const provider = new NextSmsProvider(config, request as typeof fetch, () => {})
    const result = await provider.send({ channel: 'SMS', to: '+255712345678', body: 'Hello' })
    expect(result.status).toBe('FAILED')
    expect(result.error).toBe('NextSMS rejected the message (400)')
    expect(result.error).not.toContain('0712345678')
  })

  test('returns invalid destination without calling the gateway', async () => {
    const request = mock(async () => new Response('should not be called', { status: 200 }))
    const provider = new NextSmsProvider(config, request as typeof fetch, () => {})
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
