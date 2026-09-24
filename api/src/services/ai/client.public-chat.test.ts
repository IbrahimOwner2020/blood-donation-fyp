import { describe, expect, test } from 'bun:test'

import { ErrorCodes } from '../../lib/errors'
import { AiServiceClient } from './client'

describe('AiServiceClient.publicChat', () => {
  test('returns a trimmed non-empty answer', async () => {
    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      requestTimeoutMs: 1000,
      fetch: async () =>
        new Response(JSON.stringify({ answer: '  Donors wait three months.  ' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    const result = await client.publicChat({
      message: 'When can I donate?',
      turns: [],
      toolSessionToken: 'pct_abcdefghijklmnopqrstuvwxyz012345',
      toolsUrl: 'http://api.test/api/v1/public/chat/tools',
    })

    expect(result.answer).toBe('Donors wait three months.')
  })

  test('maps empty answers to PUBLIC_CHAT_UNAVAILABLE', async () => {
    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      requestTimeoutMs: 1000,
      fetch: async () =>
        new Response(JSON.stringify({ answer: '   ' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    await expect(
      client.publicChat({
        message: 'Hello',
        turns: [],
        toolSessionToken: 'pct_abcdefghijklmnopqrstuvwxyz012345',
        toolsUrl: 'http://api.test/api/v1/public/chat/tools',
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PUBLIC_CHAT_UNAVAILABLE,
      status: 503,
    })
  })

  test('maps upstream AI errors to PUBLIC_CHAT_UNAVAILABLE', async () => {
    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      requestTimeoutMs: 1000,
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { code: 'LLM_PROVIDER_ERROR', message: 'provider down' },
          }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    })

    await expect(
      client.publicChat({
        message: 'Hello',
        turns: [],
        toolSessionToken: 'pct_abcdefghijklmnopqrstuvwxyz012345',
        toolsUrl: 'http://api.test/api/v1/public/chat/tools',
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PUBLIC_CHAT_UNAVAILABLE,
      status: 503,
    })
  })
})
