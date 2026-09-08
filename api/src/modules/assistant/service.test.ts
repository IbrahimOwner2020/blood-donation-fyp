import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { AssistantActionStore } from './action-store'
import { errorHandler } from '../../middleware'
import { assistantRoutes } from './routes'
import { handleAssistantMessage, type AssistantActionProposal } from './service'
import { assistantToolSessionStore, AssistantToolSessionStore } from './tool-session-store'
import { callAssistantTool, listAssistantTools } from './tools'

const db = {} as never

const allPermissions = [
  'reports:read',
  'donors:read',
  'donations:read',
  'alerts:read',
  'alerts:update',
  'predictions:read',
  'predictions:run',
  'notifications:read',
  'notifications:send',
  'inventory:read',
  'inventory:update',
  'requests:read',
  'users:manage',
  'roles:manage',
  'activity:read',
]

describe('handleAssistantMessage', () => {
  test('returns navigation only when the target permission is present', async () => {
    const allowed = await handleAssistantMessage(db, {
      message: 'open alerts',
    }, allPermissions)

    expect(allowed.type).toBe('navigation')
    if (allowed.type === 'navigation') {
      expect(allowed.path).toBe('/alerts')
      expect(allowed.requiredPermission).toBe('alerts:read')
    }

    const denied = await handleAssistantMessage(db, {
      message: 'open alerts',
    }, ['reports:read'])

    expect(denied).toEqual({
      type: 'permission_denied',
      requiredPermission: 'alerts:read',
      message:
        'Your account does not include alerts:read, so I cannot perform that action.',
    })
  })

  test('proposes forecast actions with the required permission and payload', async () => {
    const result = await handleAssistantMessage(db, {
      message: 'run a 14 day forecast for O+',
    }, allPermissions)

    expect(result.type).toBe('action_proposal')
    if (result.type === 'action_proposal') {
      expect(result.proposal.action).toBe('prediction.run')
      expect(result.proposal.requiredPermission).toBe('predictions:run')
      expect(result.proposal.payload).toMatchObject({
        bloodGroup: 'O+',
        horizonDays: 14,
      })
    }
  })

  test('does not propose mutation actions without permission', async () => {
    const result = await handleAssistantMessage(db, {
      message: 'resolve alert 42',
    }, ['alerts:read'])

    expect(result.type).toBe('permission_denied')
    if (result.type === 'permission_denied') {
      expect(result.requiredPermission).toBe('alerts:update')
    }
  })

  test('proposes notification previews without sending', async () => {
    const result = await handleAssistantMessage(db, {
      message: 'preview SMS to donors 1 for alert 2',
    }, allPermissions)

    expect(result.type).toBe('action_proposal')
    if (result.type === 'action_proposal') {
      expect(result.proposal.action).toBe('notification.preview')
      expect(result.proposal.requiredPermission).toBe('notifications:read')
      expect(result.proposal.payload).toEqual({
        donorIds: [1],
        channel: 'SMS',
        alertId: 2,
      })
    }
  })

  test('asks for detail without page capability fallback wording', async () => {
    const result = await handleAssistantMessage(db, {
      message: 'can you help me?',
      context: {
        pathname: '/donations',
      },
    }, allPermissions)

    expect(result.type).toBe('answer')
    if (result.type === 'answer') {
      expect(result.message).toContain('more specific question')
      expect(result.message).toContain('/donations')
      expect(result.message).not.toContain("You're on")
      expect(result.message).not.toContain('I can help across the NBTS app')
      expect(result.message).not.toContain('I can help with')
    }
  })

  test('delegates to AI-service chat when a tool session is available', async () => {
    const store = new AssistantToolSessionStore({ now: () => 10 })
    const toolSession = store.create({
      userId: 1,
      sessionId: 'session-a',
      permissions: ['reports:read'],
      requestId: 'req-1',
    })
    const calls: unknown[] = []
    const result = await handleAssistantMessage(db, {
      message: 'what happened today?',
      context: {
        pathname: '/dashboard',
      },
    }, ['reports:read'], {
      toolSession,
      toolsUrl: 'http://api.test/api/v1/assistant/tools',
      aiClient: {
        chat: async (input) => {
          calls.push(input)
          return {
            type: 'answer',
            message: 'Today has 42 available units.',
          }
        },
      },
    })

    expect(result).toEqual({
      type: 'answer',
      message: 'Today has 42 available units.',
    })
    expect(calls).toEqual([
      {
        message: 'what happened today?',
        context: {
          pathname: '/dashboard',
        },
        permissions: ['reports:read'],
        toolSessionToken: toolSession.token,
        toolsUrl: 'http://api.test/api/v1/assistant/tools',
      },
    ])
  })

  test('falls back safely when AI-service chat fails', async () => {
    const store = new AssistantToolSessionStore({ now: () => 10 })
    const toolSession = store.create({
      userId: 1,
      sessionId: 'session-a',
      permissions: ['reports:read'],
    })

    const result = await handleAssistantMessage(db, {
      message: 'can you help me?',
      context: {
        pathname: '/donations',
      },
    }, ['reports:read'], {
      toolSession,
      toolsUrl: 'http://api.test/api/v1/assistant/tools',
      aiClient: {
        chat: async () => {
          throw new Error('AI down')
        },
      },
    })

    expect(result.type).toBe('answer')
    if (result.type === 'answer') {
      expect(result.message).toContain('more specific question')
      expect(result.message).not.toContain("You're on")
      expect(result.message).not.toContain('I can help with')
    }
  })
})

describe('AssistantActionStore', () => {
  const proposal: AssistantActionProposal = {
    id: 'act_test_action',
    action: 'alert.status',
    title: 'Resolve alert #1',
    description: 'Change shortage alert #1 status to RESOLVED.',
    requiredPermission: 'alerts:update',
    payload: { alertId: 1, status: 'RESOLVED' },
    effect: 'Updates the alert lifecycle and records an audit event.',
  }

  test('returns actions only for the creating user and session', () => {
    const store = new AssistantActionStore({ ttlMs: 1000, now: () => 10 })
    store.put(proposal, { userId: 1, sessionId: 'session-a' })

    expect(store.take(proposal.id, { userId: 2, sessionId: 'session-a' })).toBeNull()
    expect(store.take(proposal.id, { userId: 1, sessionId: 'session-b' })).toBeNull()
    expect(store.take(proposal.id, { userId: 1, sessionId: 'session-a' })?.id).toBe(proposal.id)
    expect(store.take(proposal.id, { userId: 1, sessionId: 'session-a' })).toBeNull()
  })

  test('expires pending actions', () => {
    let now = 10
    const store = new AssistantActionStore({ ttlMs: 1000, now: () => now })
    store.put(proposal, { userId: 1, sessionId: 'session-a' })
    now = 1011

    expect(store.take(proposal.id, { userId: 1, sessionId: 'session-a' })).toBeNull()
  })
})

describe('assistant tool sessions and tools', () => {
  test('registers every expected MCP-like assistant tool descriptor', () => {
    const tools = listAssistantTools({
      token: 'ast_test',
      userId: 1,
      sessionId: 'session-a',
      permissions: allPermissions,
      requestId: null,
      expiresAt: 100,
    })
    const names = tools.map((tool) => tool.name).sort()

    expect(names).toEqual([
      'alerts.get',
      'alerts.propose_recalculate',
      'alerts.propose_status_update',
      'alerts.search',
      'dashboard.alerts',
      'dashboard.predictions',
      'dashboard.summary',
      'dashboard.trends',
      'donations.get',
      'donations.search',
      'donors.get',
      'donors.search',
      'inventory.get',
      'inventory.propose_update',
      'inventory.search',
      'navigation.propose',
      'notifications.propose_preview',
      'notifications.propose_send',
      'predictions.propose_run',
    ])
  })

  test('expires internal tool sessions', () => {
    let now = 10
    const store = new AssistantToolSessionStore({ ttlMs: 1000, now: () => now })
    const session = store.create({
      userId: 1,
      sessionId: 'session-a',
      permissions: ['reports:read'],
    })

    expect(store.get(session.token)?.userId).toBe(1)
    now = 1011
    expect(store.get(session.token)).toBeNull()
  })

  test('tool calls re-check permissions before proposing mutations', async () => {
    await expect(callAssistantTool(db, {
      token: 'ast_test',
      userId: 1,
      sessionId: 'session-a',
      permissions: [],
      requestId: null,
      expiresAt: 100,
    }, 'inventory.propose_update', {
      inventoryId: 1,
      status: 'RESERVED',
    })).rejects.toThrow('Assistant tool requires inventory:update')
  })

  test('tool list route requires and honors bearer tool session', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.route('/', assistantRoutes)

    const unauthorized = await app.request('/tools/list', {
      method: 'POST',
    })
    expect(unauthorized.status).toBe(401)

    const session = assistantToolSessionStore.create({
      userId: 1,
      sessionId: 'session-a',
      permissions: ['donations:read'],
    })
    const authorized = await app.request('/tools/list', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    })
    const body = await authorized.json()

    expect(authorized.status).toBe(200)
    expect(body.data.tools.some((tool: { name: string }) => tool.name === 'donations.search')).toBe(true)
    expect(body.data.tools.some((tool: { name: string }) => tool.name === 'alerts.search')).toBe(false)
  })
})
