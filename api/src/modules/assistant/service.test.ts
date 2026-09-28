import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { AssistantActionStore } from './action-store'
import { AppError, ErrorCodes } from '../../lib/errors'
import { errorHandler } from '../../middleware'
import { assistantRoutes } from './routes'
import { handleAssistantMessage, type AssistantActionProposal } from './service'
import { assistantToolSessionStore, AssistantToolSessionStore } from './tool-session-store'
import { callAssistantTool, listAssistantTools, normalizeAssistantToolArgs } from './tools'

const db = {} as never

const allPermissions = [
  'reports:read',
  'donors:read',
  'donations:read',
  'notifications:read',
  'notifications:send',
  'inventory:read',
  'inventory:update',
  'requests:read',
  'users:manage',
  'roles:manage',
  'activity:read',
  'facilities:read',
]

describe('handleAssistantMessage', () => {
  test('returns navigation only when the target permission is present', async () => {
    const allowed = await handleAssistantMessage(db, {
      message: 'open reports',
    }, allPermissions)

    expect(allowed.type).toBe('navigation')
    if (allowed.type === 'navigation') {
      expect(allowed.path).toBe('/reports')
      expect(allowed.requiredPermission).toBe('reports:read')
    }

    const denied = await handleAssistantMessage(db, {
      message: 'open reports',
    }, [])

    expect(denied).toEqual({
      type: 'permission_denied',
      requiredPermission: 'reports:read',
      message:
        'Your account does not include reports:read, so I cannot perform that action.',
    })
  })

  test('falls back to the canonical facility route when AI returns an unknown path', async () => {
    const store = new AssistantToolSessionStore({ now: () => 10 })
    const toolSession = store.create({
      userId: 1,
      sessionId: 'session-a',
      permissions: ['facilities:read'],
    })

    const result = await handleAssistantMessage(db, {
      message: 'open facilities',
    }, ['facilities:read'], {
      toolSession,
      toolsUrl: 'http://api.test/api/v1/assistant/tools',
      aiClient: {
        chat: async () => ({
          type: 'navigation',
          message: 'Opening facilities.',
          path: '/facilities',
        }),
      },
    })

    expect(result).toEqual({
      type: 'navigation',
      path: '/admin/facilities',
      requiredPermission: 'facilities:read',
      message: 'Opening facilities.',
    })
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

  test('shows the explicit unavailable state without a fixed data fallback', async () => {
    const result = await handleAssistantMessage(db, {
      message: 'can you help me?',
      context: {
        pathname: '/donations',
      },
    }, allPermissions)

    expect(result).toMatchObject({
      type: 'answer',
      unavailableCode: 'AI_SERVICE_UNAVAILABLE',
      unavailableStage: 'provider',
      retryable: true,
    })
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
      expect(result.unavailableCode).toBe('AI_SERVICE_UNAVAILABLE')
      expect(result.message).toContain('could not reach')
    }
  })

  test('reports an AI timeout instead of an unreachable service', async () => {
    const store = new AssistantToolSessionStore({ now: () => 10 })
    const toolSession = store.create({ userId: 1, sessionId: 'session-a', permissions: ['reports:read'] })

    const result = await handleAssistantMessage(db, { message: 'summarize stock' }, ['reports:read'], {
      toolSession,
      toolsUrl: 'http://api.test/api/v1/assistant/tools',
      aiClient: {
        chat: async () => {
          throw new AppError('AI service chat timed out after 30000ms', {
            code: ErrorCodes.INTERNAL_ERROR,
            status: 504,
            details: [{ code: 'AI_TIMEOUT', message: 'AI service chat timed out after 30000ms' }],
          })
        },
      },
    })

    expect(result).toMatchObject({
      type: 'answer',
      unavailableCode: 'AI_TIMEOUT',
      unavailableStage: 'provider',
      retryable: true,
    })
  })

  test('reports the first contract violation when the AI layout fails API validation', async () => {
    const store = new AssistantToolSessionStore({ now: () => 10 })
    const toolSession = store.create({ userId: 1, sessionId: 'session-a', permissions: ['reports:read'] })

    const result = await handleAssistantMessage(db, { message: 'summarize stock' }, ['reports:read'], {
      toolSession,
      toolsUrl: 'http://api.test/api/v1/assistant/tools',
      aiClient: {
        chat: async () => ({
          type: 'composed_answer',
          message: 'Stock summary is ready.',
          sources: [{ sourceId: 'source_summary', tool: 'dashboard.summary', arguments: {} }],
          composition: {
            title: 'Stock',
            summary: 'Current stock.',
            language: 'en',
            sections: [{
              id: 'Overview',
              layout: 'grid',
              blocks: [{ id: 'summary', type: 'narrative', width: 'full', content: 'Stock is available.', sourceIds: ['source_summary'] }],
            }],
          },
        }),
      },
    })

    expect(result).toMatchObject({
      type: 'answer',
      unavailableCode: 'ASSISTANT_RESPONSE_INVALID',
      unavailableStage: 'composition',
    })
    if (result.type === 'answer') {
      expect(result.message).toContain('composition.sections.0.id')
    }
  })
})

describe('AssistantActionStore', () => {
  const proposal: AssistantActionProposal = {
    id: 'act_test_action',
    action: 'inventory.update',
    title: 'Reserve inventory unit #1',
    description: 'Change inventory unit #1 status to RESERVED.',
    requiredPermission: 'inventory:update',
    payload: { inventoryId: 1, status: 'RESERVED' },
    effect: 'Updates inventory after confirmation and records an audit event.',
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
  test('normalizes aggregate and lowercase blood-group filters from the model', () => {
    expect(normalizeAssistantToolArgs({ bloodGroup: 'all', limit: 10 })).toEqual({ limit: 10 })
    expect(normalizeAssistantToolArgs({ bloodGroup: 'o+' })).toEqual({ bloodGroup: 'O+' })
    expect(normalizeAssistantToolArgs({ bloodGroup: null })).toEqual({})
  })

  test('normalizes model boolean flags and enum casing to query-string values', () => {
    expect(normalizeAssistantToolArgs({ activeOnly: true, severity: 'high', status: ' open ' })).toEqual({
      activeOnly: 'true',
      severity: 'HIGH',
      status: 'OPEN',
    })
    expect(normalizeAssistantToolArgs({ availableOnly: false, priority: 'urgent' })).toEqual({
      availableOnly: 'false',
      priority: 'URGENT',
    })
    expect(normalizeAssistantToolArgs({ limit: 1000 })).toEqual({ limit: 100 })
    expect(normalizeAssistantToolArgs({ limit: 0 })).toEqual({ limit: 1 })
  })

  test('drops blank and null optional arguments the model fills in', () => {
    expect(normalizeAssistantToolArgs({ q: '', status: null, facilityId: '  ', limit: 20 })).toEqual({ limit: 20 })
  })

  test('navigation tool resolves a label when the model omits the path', async () => {
    const session = {
      token: 'ast_test',
      userId: 1,
      sessionId: 'session-a',
      permissions: ['reports:read'],
      requestId: null,
      facilityId: null,
      expiresAt: 100,
    }

    await expect(callAssistantTool(db, session, 'navigation.propose', { label: 'Reports page' })).resolves.toEqual({
      type: 'navigation',
      path: '/reports',
      message: 'Opening Reports page.',
      requiredPermission: 'reports:read',
    })
    await expect(callAssistantTool(db, session, 'navigation.propose', {})).rejects.toThrow('Invalid assistant tool navigation.propose')
  })

  test('registers every expected MCP-like assistant tool descriptor', () => {
    const tools = listAssistantTools({
      token: 'ast_test',
      userId: 1,
      sessionId: 'session-a',
      permissions: allPermissions,
      requestId: null,
      facilityId: null,
      expiresAt: 100,
    })
    const names = tools.map((tool) => tool.name).sort()

    expect(names).toEqual([
      'ai_analysis.get',
      'ai_analysis.propose_run',
      'ai_analysis.search',
      'blood_requests.get',
      'blood_requests.search',
      'dashboard.alerts',
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
      'predictions.history',
      'reports.blood_requests',
      'reports.donations',
      'reports.donor_eligibility',
      'reports.inventory',
      'reports.notifications',
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
      facilityId: null,
      expiresAt: 100,
    }, 'inventory.propose_update', {
      inventoryId: 1,
      status: 'RESERVED',
    })).rejects.toThrow('Assistant tool requires inventory:update')
  })

  test('navigation tool only permits real application routes', async () => {
    const session = {
      token: 'ast_test',
      userId: 1,
      sessionId: 'session-a',
      permissions: ['facilities:read'],
      requestId: null,
      facilityId: null,
      expiresAt: 100,
    }

    await expect(callAssistantTool(db, session, 'navigation.propose', {
      path: '/does-not-exist',
      label: 'missing',
    })).rejects.toThrow()

    await expect(callAssistantTool(db, session, 'navigation.propose', {
      path: '/facilities',
      label: 'facilities',
    })).resolves.toEqual({
      type: 'navigation',
      path: '/admin/facilities',
      message: 'Opening facilities.',
      requiredPermission: 'facilities:read',
    })

    await expect(callAssistantTool(db, session, 'navigation.propose', {
      path: '/admin/facilities',
      label: 'facilities',
    })).resolves.toEqual({
      type: 'navigation',
      path: '/admin/facilities',
      message: 'Opening facilities.',
      requiredPermission: 'facilities:read',
    })
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
