import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { AppError, ErrorCodes } from '../../lib/errors'
import { errorHandler } from '../../middleware'
import { publicChatMessageSchema } from './schemas'
import { handlePublicChatMessage } from './service'
import {
  PublicChatToolSessionStore,
  publicChatToolSessionStore,
} from './tool-session-store'
import { callPublicChatTool, listPublicChatTools } from './tools'
import { publicChatRoutes } from './routes'

describe('publicChatMessageSchema', () => {
  test('accepts message without language', () => {
    const parsed = publicChatMessageSchema.parse({
      message: 'When can I donate again?',
    })
    expect(parsed.message).toBe('When can I donate again?')
    expect(parsed.language).toBeUndefined()
    expect(parsed.turns).toEqual([])
  })

  test('rejects invalid language', () => {
    const result = publicChatMessageSchema.safeParse({
      message: 'Hello',
      language: 'fr',
    })
    expect(result.success).toBe(false)
  })

  test('accepts en and sw', () => {
    expect(publicChatMessageSchema.parse({ message: 'Hi', language: 'en' }).language).toBe('en')
    expect(publicChatMessageSchema.parse({ message: 'Habari', language: 'sw' }).language).toBe('sw')
  })

  test('accepts assistant history longer than the user message limit', () => {
    const assistantAnswer = 'A'.repeat(1200)
    const parsed = publicChatMessageSchema.parse({
      message: 'Can you explain that?',
      turns: [
        { role: 'user', content: 'Tell me about donation.' },
        { role: 'assistant', content: assistantAnswer },
      ],
    })

    expect(parsed.turns[1]?.content).toHaveLength(1200)
  })
})

describe('PublicChatToolSessionStore', () => {
  test('expires short-lived tokens', () => {
    let now = 10
    const store = new PublicChatToolSessionStore({ ttlMs: 1000, now: () => now })
    const session = store.create({ requestId: 'req-1' })
    expect(store.get(session.token)?.requestId).toBe('req-1')
    now = 1011
    expect(store.get(session.token)).toBeNull()
  })
})

describe('public chat tools', () => {
  test('lists only the allow-listed read-only tools', () => {
    const names = listPublicChatTools().map((tool) => tool.name).sort()
    expect(names).toEqual(['donation_centres.search', 'donation_guidance.lookup'])
    expect(listPublicChatTools().every((tool) => tool.mutates === false)).toBe(true)
  })

  test('returns approved guidance for a topic', async () => {
    const db = {} as never
    const result = await callPublicChatTool(db, 'donation_guidance.lookup', {
      topic: 'age',
    }) as {
      topic: string
      guidance: Array<{ en: string; sw: string }>
      medicalClearance: boolean
      screeningRequired: boolean
    }

    expect(result.topic).toBe('age')
    expect(result.guidance).toHaveLength(1)
    expect(result.guidance[0]?.en).toContain('18 to 65')
    expect(result.medicalClearance).toBe(false)
    expect(result.screeningRequired).toBe(true)
  })

  test('rejects unknown tools', async () => {
    const db = {} as never
    await expect(
      callPublicChatTool(db, 'donors.search', {}),
    ).rejects.toThrow('Unknown public chat tool')
  })

  test('centre search returns only active public fields and bounds results', async () => {
    const centres = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      name: `Centre ${index + 1}`,
      region: index % 2 === 0 ? 'Dar' : 'Dodoma',
      address: `Street ${index + 1}`,
      active: true,
    }))
    const where = async () => centres
    const db = {
      select: () => ({
        from: () => ({
          orderBy: () => ({
            where,
            then: (resolve: (value: typeof centres) => unknown) => resolve(centres),
          }),
        }),
      }),
    } as never

    const result = await callPublicChatTool(db, 'donation_centres.search', {
      region: 'Dar',
    }) as {
      centres: Array<{ id: number; name: string; region: string; address: string | null; active?: boolean }>
      total: number
      truncated: boolean
    }

    expect(result.total).toBe(12)
    expect(result.truncated).toBe(true)
    expect(result.centres).toHaveLength(10)
    expect(result.centres[0]).toEqual({
      id: 1,
      name: 'Centre 1',
      region: 'Dar',
      address: 'Street 1',
    })
    expect(result.centres[0]).not.toHaveProperty('active')

    const allRegions = await callPublicChatTool(db, 'donation_centres.search', {
      region: '',
    }) as { total: number }
    expect(allRegions.total).toBe(12)
  })
})

describe('handlePublicChatMessage', () => {
  test('returns assistant answer and English disclaimer by default', async () => {
    const calls: unknown[] = []
    const result = await handlePublicChatMessage(
      { message: 'What is the minimum age?', turns: [] },
      {
        toolsUrl: 'http://api.test/api/v1/public/chat/tools',
        toolSession: {
          token: 'pct_abcdefghijklmnopqrstuvwxyz012345',
          requestId: null,
          expiresAt: Date.now() + 60_000,
        },
        aiClient: {
          publicChat: async (input) => {
            calls.push(input)
            return { answer: 'Donors are generally 18 to 65 years old.' }
          },
        },
      },
    )

    expect(result.source).toBe('assistant')
    expect(result.answer).toContain('18 to 65')
    expect(result.disclaimer).toContain('not medical clearance')
    expect(calls).toEqual([
      {
        message: 'What is the minimum age?',
        turns: [],
        toolSessionToken: 'pct_abcdefghijklmnopqrstuvwxyz012345',
        toolsUrl: 'http://api.test/api/v1/public/chat/tools',
      },
    ])
  })

  test('passes optional language and uses Kiswahili disclaimer', async () => {
    const calls: unknown[] = []
    const result = await handlePublicChatMessage(
      { message: 'Nina umri gani?', language: 'sw', turns: [] },
      {
        toolsUrl: 'http://api.test/api/v1/public/chat/tools',
        toolSession: {
          token: 'pct_abcdefghijklmnopqrstuvwxyz012345',
          requestId: null,
          expiresAt: Date.now() + 60_000,
        },
        aiClient: {
          publicChat: async (input) => {
            calls.push(input)
            return { answer: 'Umri wa kawaida ni miaka 18 hadi 65.' }
          },
        },
      },
    )

    expect(result.disclaimer).toContain('si ruhusa')
    expect(calls[0]).toMatchObject({ language: 'sw' })
  })

  test('maps AI failures to PUBLIC_CHAT_UNAVAILABLE without canned guidance', async () => {
    await expect(
      handlePublicChatMessage(
        { message: 'When can I donate again?', turns: [] },
        {
          toolsUrl: 'http://api.test/api/v1/public/chat/tools',
          toolSession: {
            token: 'pct_abcdefghijklmnopqrstuvwxyz012345',
            requestId: null,
            expiresAt: Date.now() + 60_000,
          },
          aiClient: {
            publicChat: async () => {
              throw new Error('AI down')
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.PUBLIC_CHAT_UNAVAILABLE,
      status: 503,
    })
  })

  test('re-throws PUBLIC_CHAT_UNAVAILABLE from the client', async () => {
    await expect(
      handlePublicChatMessage(
        { message: 'Hello', turns: [] },
        {
          toolsUrl: 'http://api.test/api/v1/public/chat/tools',
          toolSession: {
            token: 'pct_abcdefghijklmnopqrstuvwxyz012345',
            requestId: null,
            expiresAt: Date.now() + 60_000,
          },
          aiClient: {
            publicChat: async () => {
              throw AppError.publicChatUnavailable('empty answer')
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.PUBLIC_CHAT_UNAVAILABLE,
      message: 'empty answer',
    })
  })
})

describe('public chat tool routes', () => {
  test('tool list requires a valid bearer session', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.route('/', publicChatRoutes)

    const unauthorized = await app.request('/tools/list', { method: 'POST' })
    expect(unauthorized.status).toBe(401)

    const expired = await app.request('/tools/list', {
      method: 'POST',
      headers: { authorization: 'Bearer pct_deadbeefdeadbeefdeadbeefdeadbeef' },
    })
    expect(expired.status).toBe(401)

    const session = publicChatToolSessionStore.create({ requestId: 'req-public' })
    const authorized = await app.request('/tools/list', {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
    })
    const body = await authorized.json() as {
      data: { tools: Array<{ name: string }> }
    }

    expect(authorized.status).toBe(200)
    expect(body.data.tools.map((tool) => tool.name).sort()).toEqual([
      'donation_centres.search',
      'donation_guidance.lookup',
    ])
  })

  test('tool call rejects unknown tools with 400', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.route('/', publicChatRoutes)

    const session = publicChatToolSessionStore.create({})
    const response = await app.request('/tools/call', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'donors.search', arguments: {} }),
    })
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('BAD_REQUEST')
  })
})
