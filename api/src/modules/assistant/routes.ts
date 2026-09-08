/**
 * Permissioned app assistant routes.
 * Mounted under /api/v1/assistant.
 */

import type { Context } from 'hono'
import { Hono } from 'hono'

import { getDb } from '../../db'
import { AppError } from '../../lib/errors'
import { getEnv } from '../../lib/env'
import { PERMISSION_CODES } from '../../lib/permissions'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { attachUserAccess } from '../../middleware/require-permission'
import { filterKnownPermissionCodes } from '../auth/user-access'
import { createAiClient } from '../../services/ai'
import { recordActivity } from '../../services/audit'
import type { ActivityMetadata } from '../../services/audit'
import { assistantActionStore } from './action-store'
import {
  assistantActionParamSchema,
  assistantMessageBodySchema,
  assistantToolCallBodySchema,
} from './schemas'
import {
  AssistantAuditActions,
  executeAssistantAction,
  handleAssistantMessage,
  type AssistantActionProposal,
} from './service'
import { callAssistantTool, listAssistantTools } from './tools'
import { assistantToolSessionStore, type AssistantToolSession } from './tool-session-store'

export const assistantRoutes = new Hono<AppHonoEnv>()

function clientIp(c: Context<AppHonoEnv>): string | null {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    return first || null
  }
  return c.req.header('x-real-ip')?.trim() || null
}

function toolBearer(c: Context<AppHonoEnv>): string {
  const header = c.req.header('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  if (!token) {
    throw AppError.unauthorized('Assistant tool session required')
  }
  return token
}

function requireToolSession(c: Context<AppHonoEnv>): AssistantToolSession {
  const session = assistantToolSessionStore.get(toolBearer(c))
  if (!session) {
    throw AppError.unauthorized('Assistant tool session expired')
  }
  return session
}

async function auditAssistant(
  c: Context<AppHonoEnv>,
  action: string,
  metadata: ActivityMetadata,
): Promise<void> {
  await recordActivity({
    actorUserId: c.get('user')?.id ?? null,
    action,
    entityType: 'assistant',
    entityId: typeof metadata.actionId === 'string' ? metadata.actionId : null,
    metadata,
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })
}

function owner(c: Context<AppHonoEnv>): { userId: number; sessionId: string } {
  const user = c.get('user')
  const sessionId = c.get('sessionId')
  if (!user?.id || !sessionId) {
    throw AppError.unauthorized('Authenticated session required')
  }
  return { userId: user.id, sessionId }
}

assistantRoutes.post('/tools/list', async (c) => {
  const session = requireToolSession(c)
  return jsonOk(c, {
    tools: listAssistantTools(session),
  })
})

assistantRoutes.post('/tools/call', async (c) => {
  const session = requireToolSession(c)
  const body = await parseJsonBody(c, assistantToolCallBodySchema)
  try {
    const result = await callAssistantTool(
      getDb(),
      session,
      body.name,
      body.arguments ?? {},
    )
    await recordActivity({
      actorUserId: session.userId,
      action: 'assistant.tool_called',
      entityType: 'assistant',
      entityId: body.name,
      metadata: {
        tool: body.name,
        mutatingProposalOnly: true,
      },
      requestId: session.requestId,
      ipAddress: clientIp(c),
    })
    return jsonOk(c, {
      tool: body.name,
      result,
    })
  } catch (error) {
    if (AppError.isAppError(error) && error.code === 'FORBIDDEN') {
      await recordActivity({
        actorUserId: session.userId,
        action: AssistantAuditActions.DENIED,
        entityType: 'assistant',
        entityId: body.name,
        metadata: {
          tool: body.name,
          message: error.message,
        },
        requestId: session.requestId,
        ipAddress: clientIp(c),
      })
    }
    throw error
  }
})

assistantRoutes.use('*', requireAuth, attachUserAccess())

assistantRoutes.post('/message', async (c) => {
  const body = await parseJsonBody(c, assistantMessageBodySchema)
  const currentOwner = owner(c)
  const permissions = filterKnownPermissionCodes(
    c.get('permissions') ?? [],
    PERMISSION_CODES,
  )
  const toolSession = assistantToolSessionStore.create({
    ...currentOwner,
    permissions,
    requestId: c.get('requestId') ?? null,
  })
  const origin = new URL(c.req.url).origin
  const env = getEnv()
  const toolsOrigin = env.API_INTERNAL_BASE_URL ?? origin
  const toolsUrl = `${toolsOrigin.replace(/\/+$/, '')}/api/v1/assistant/tools`
  const result = await handleAssistantMessage(getDb(), body, permissions, {
    aiClient: createAiClient(env),
    toolSession,
    toolsUrl,
  })

  if (result.type === 'permission_denied') {
    await auditAssistant(c, AssistantAuditActions.DENIED, {
      requiredPermission: result.requiredPermission,
      message: body.message,
    })
    return jsonOk(c, result)
  }

  if (result.type === 'action_proposal') {
    const payload =
      result.proposal.action === 'notification.send'
        ? { ...result.proposal.payload, actorUserId: currentOwner.userId }
        : result.proposal.payload
    const stored: AssistantActionProposal = {
      ...result.proposal,
      payload,
    }
    const proposalForClient = assistantActionStore.put(stored, currentOwner)
    await auditAssistant(c, AssistantAuditActions.PROPOSED, {
      actionId: proposalForClient.id,
      assistantAction: proposalForClient.action,
      requiredPermission: proposalForClient.requiredPermission,
      effect: proposalForClient.effect,
    })
    return jsonOk(c, {
      ...result,
      proposal: proposalForClient,
    })
  }

  return jsonOk(c, result)
})

assistantRoutes.post('/actions/:id/confirm', async (c) => {
  const { id } = parseParams(c, assistantActionParamSchema)
  const currentOwner = owner(c)
  const proposal = assistantActionStore.take(id, currentOwner)
  if (!proposal) {
    throw AppError.notFound('Assistant action expired or is not available for this session')
  }

  await auditAssistant(c, AssistantAuditActions.CONFIRMED, {
    actionId: proposal.id,
    assistantAction: proposal.action,
    requiredPermission: proposal.requiredPermission,
  })

  try {
    const result = await executeAssistantAction(
      getDb(),
      proposal,
      c.get('permissions') ?? [],
    )
    await auditAssistant(c, AssistantAuditActions.COMPLETED, {
      actionId: proposal.id,
      assistantAction: proposal.action,
      requiredPermission: proposal.requiredPermission,
    })
    return jsonOk(c, {
      type: 'action_result',
      ...result,
    })
  } catch (error) {
    await auditAssistant(c, AssistantAuditActions.FAILED, {
      actionId: proposal.id,
      assistantAction: proposal.action,
      requiredPermission: proposal.requiredPermission,
      error: error instanceof Error ? error.message : 'unknown',
    })
    throw error
  }
})
