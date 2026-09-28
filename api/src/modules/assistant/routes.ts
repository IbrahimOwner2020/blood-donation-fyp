/**
 * Permissioned app assistant routes.
 * Mounted under /api/v1/assistant.
 */

import type { Context } from 'hono'
import { Hono } from 'hono'

import { getDb } from '../../db'
import { AppError } from '../../lib/errors'
import { getEnv } from '../../lib/env'
import { logWarn } from '../../lib/logger'
import { PERMISSION_CODES } from '../../lib/permissions'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { attachUserAccess } from '../../middleware/require-permission'
import { filterKnownPermissionCodes } from '../auth/user-access'
import { createAiClient } from '../../services/ai'
import { recordActivity } from '../../services/audit'
import type { ActivityMetadata } from '../../services/audit'
import { assistantActionStore } from './action-store'
import {
  assistantActionParamSchema,
  assistantConversationMessageBodySchema,
  assistantConversationParamSchema,
  assistantDraftParamSchema,
  assistantMessageBodySchema,
  assistantReportExportQuerySchema,
  assistantReportParamSchema,
  assistantToolCallBodySchema,
  createAssistantConversationBodySchema,
  updateAssistantConversationBodySchema,
  updateAssistantDraftBodySchema,
  type AssistantBlock,
} from './schemas'
import {
  AssistantAuditActions,
  createAssistantProposal,
  executeAssistantAction,
  handleAssistantMessage,
  type AssistantActionProposal,
} from './service'
import { callAssistantTool, listAssistantTools, sanitizeAssistantToolResult } from './tools'
import { assistantToolSessionStore, type AssistantToolSession } from './tool-session-store'
import {
  addAssistantMessage,
  cancelAssistantProposal,
  consumeAssistantProposal,
  createAssistantArtifact,
  createAssistantConversation,
  createAssistantDraft,
  deleteAssistantConversation,
  getAssistantArtifact,
  getAssistantConversation,
  getAssistantConversationWithMessages,
  getAssistantDraft,
  listAssistantConversations,
  markAssistantProposalFailed,
  persistAssistantProposal,
  updateAssistantConversation,
  updateAssistantDraft,
} from './persistence'
import {
  buildAssistantReport,
  detectAssistantLanguage,
  renderAssistantReportCsv,
  renderAssistantReportPdf,
  reportSnapshotBlocks,
  type AssistantReportSnapshot,
  type AssistantReportType,
} from './reports'
import {
  compositionRequiredPermissions,
  executeCompositionSources,
  previewAssistantComposition,
  resolveAssistantComposition,
  type AssistantCompositionSnapshot,
} from './composition'
import {
  buildDraftFormBlock,
  detectDraftWorkflow,
  extractDraftValues,
  validateDraftValues,
  workflowPermission,
  type AssistantDraftWorkflow,
} from './drafts'
import { eq } from 'drizzle-orm'
import { bloodGroups } from '../../db/schema'
import { requireHospitalFacilityId } from '../auth/access-scope'
import { getInventoryById } from '../inventory/service'

export const assistantRoutes = new Hono<AppHonoEnv>()

const STAFF_ASSISTANT_PERMISSIONS = new Set([
  'reports:read',
  'donors:read',
  'donors:create',
  'donations:read',
  'donations:create',
  'inventory:read',
  'inventory:update',
  'requests:read',
  'requests:create',
  'alerts:read',
  'notifications:read',
  'notifications:send',
])

function requireAssistantStaff(c: Context<AppHonoEnv>): void {
  const permissions = c.get('permissions') ?? []
  if (!permissions.some((permission) => STAFF_ASSISTANT_PERMISSIONS.has(permission))) {
    throw AppError.forbidden('The operational assistant is available to authorized staff only')
  }
}

function explicitlyRequestsReport(message: string): boolean {
  return /\b(report|export|pdf|csv|ripoti|hamisha)\b/i.test(message)
}

function compositionCsvSections(composition: AssistantCompositionSnapshot['composition']) {
  return composition.sections.flatMap((section) => section.blocks)
    .filter((block) => block.type === 'table')
    .map((block) => ({ id: block.id, label: block.title }))
}

function hasCurrentPermission(c: Context<AppHonoEnv>, permission: string): boolean {
  return (c.get('permissions') ?? []).includes(permission)
}

function serializeConversation(row: {
  id: string
  title: string
  preferredLanguage: 'en' | 'sw'
  lastMessageAt: Date
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    title: row.title,
    preferredLanguage: row.preferredLanguage,
    lastMessageAt: row.lastMessageAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeMessage(row: {
  id: string
  conversationId: string
  role: 'USER' | 'ASSISTANT'
  language: 'en' | 'sw'
  blocksJson: unknown
  suggestionsJson: unknown
  createdAt: Date
}) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    language: row.language,
    blocks: Array.isArray(row.blocksJson) ? row.blocksJson : [],
    suggestions: Array.isArray(row.suggestionsJson) ? row.suggestionsJson : [],
    createdAt: row.createdAt.toISOString(),
  }
}

function legacyResultBlocks(result: Awaited<ReturnType<typeof handleAssistantMessage>>): AssistantBlock[] {
  if (result.type === 'permission_denied') {
    return [{ type: 'notice', tone: 'error', title: 'Access denied', message: result.message }]
  }
  if (result.type === 'action_proposal') {
    return [{
      type: 'text',
      content: result.message,
    }]
  }
  if (result.type === 'answer' && result.unavailableCode) {
    return [{
      type: 'notice',
      tone: 'error',
      title: 'Assistant unavailable',
      message: `${result.message} (${result.unavailableCode})`,
    }]
  }
  return [{ type: 'text', content: result.message }]
}

async function assertArtifactAccess(c: Context<AppHonoEnv>, artifact: Awaited<ReturnType<typeof getAssistantArtifact>>) {
  if (!hasCurrentPermission(c, artifact.requiredPermission)) {
    throw AppError.forbidden(`Assistant report requires ${artifact.requiredPermission}`)
  }
  const currentFacilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
  const snapshot = artifact.snapshotJson as { version?: unknown; requiredPermissions?: unknown }
  if (snapshot.version === 2 && Array.isArray(snapshot.requiredPermissions)) {
    for (const permission of snapshot.requiredPermissions) {
      if (typeof permission === 'string' && !hasCurrentPermission(c, permission)) {
        throw AppError.forbidden(`Assistant report requires ${permission}`)
      }
    }
  }
  if (artifact.facilityId === null && typeof currentFacilityId === 'number') {
    throw AppError.forbidden('Assistant report is outside the current facility scope')
  }
  if (typeof artifact.facilityId === 'number' && typeof currentFacilityId === 'number' && artifact.facilityId !== currentFacilityId) {
    throw AppError.forbidden('Assistant report is outside the current facility scope')
  }
}

async function assertProposalFacilityScope(
  c: Context<AppHonoEnv>,
  proposal: Pick<AssistantActionProposal, 'action' | 'payload'>,
) {
  const currentFacilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
  if (typeof currentFacilityId !== 'number') return

  if (proposal.action === 'donation.create' || proposal.action === 'blood_request.create') {
    if (Number(proposal.payload.facilityId) !== currentFacilityId) {
      throw AppError.forbidden('Assistant action is outside the current facility scope')
    }
  }

  if (proposal.action === 'inventory.update') {
    const inventoryId = Number(proposal.payload.inventoryId)
    const current = await getInventoryById(getDb(), inventoryId)
    const targetFacilityId = proposal.payload.facilityId === undefined
      ? current.facilityId
      : Number(proposal.payload.facilityId)
    if (current.facilityId !== currentFacilityId || targetFacilityId !== currentFacilityId) {
      throw AppError.forbidden('Assistant inventory action is outside the current facility scope')
    }
  }

  if (proposal.action === 'ai_analysis.run') {
    throw AppError.forbidden('National AI analysis cannot be run from a facility-scoped account')
  }
}

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
      result: sanitizeAssistantToolResult(result),
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

assistantRoutes.get('/conversations', async (c) => {
  requireAssistantStaff(c)
  const currentOwner = owner(c)
  const conversations = await listAssistantConversations(getDb(), currentOwner.userId)
  return jsonOk(c, { conversations: conversations.map(serializeConversation) })
})

assistantRoutes.post('/conversations', async (c) => {
  requireAssistantStaff(c)
  const body = await parseJsonBody(c, createAssistantConversationBodySchema)
  const currentOwner = owner(c)
  const conversation = await createAssistantConversation(getDb(), currentOwner.userId, body)
  return jsonOk(c, { conversation: serializeConversation(conversation) }, 201)
})

assistantRoutes.get('/conversations/:id', async (c) => {
  requireAssistantStaff(c)
  const { id } = parseParams(c, assistantConversationParamSchema)
  const currentOwner = owner(c)
  const result = await getAssistantConversationWithMessages(getDb(), id, currentOwner.userId)
  return jsonOk(c, {
    conversation: serializeConversation(result.conversation),
    messages: result.messages.map(serializeMessage),
  })
})

assistantRoutes.patch('/conversations/:id', async (c) => {
  requireAssistantStaff(c)
  const { id } = parseParams(c, assistantConversationParamSchema)
  const body = await parseJsonBody(c, updateAssistantConversationBodySchema)
  const currentOwner = owner(c)
  const conversation = await updateAssistantConversation(getDb(), id, currentOwner.userId, body)
  return jsonOk(c, { conversation: serializeConversation(conversation) })
})

assistantRoutes.delete('/conversations/:id', async (c) => {
  requireAssistantStaff(c)
  const { id } = parseParams(c, assistantConversationParamSchema)
  const currentOwner = owner(c)
  await deleteAssistantConversation(getDb(), id, currentOwner.userId)
  return jsonOk(c, { deleted: true })
})

assistantRoutes.post('/conversations/:id/messages', async (c) => {
  requireAssistantStaff(c)
  const { id } = parseParams(c, assistantConversationParamSchema)
  const body = await parseJsonBody(c, assistantConversationMessageBodySchema)
  const currentOwner = owner(c)
  const db = getDb()
  const conversationState = await getAssistantConversationWithMessages(db, id, currentOwner.userId)
  const language = detectAssistantLanguage(body.message, body.language ?? conversationState.conversation.preferredLanguage)
  const userMessage = await addAssistantMessage(db, {
    conversationId: id,
    ownerUserId: currentOwner.userId,
    role: 'USER',
    language,
    blocks: [{ type: 'text', content: body.message }],
  })

  const workflow = detectDraftWorkflow(body.message)
  if (workflow) {
    const requiredPermission = workflowPermission(workflow)
    if (!hasCurrentPermission(c, requiredPermission)) {
      const assistantMessage = await addAssistantMessage(db, {
        conversationId: id,
        ownerUserId: currentOwner.userId,
        role: 'ASSISTANT',
        language,
        blocks: [{ type: 'notice', tone: 'error', message: `This workflow requires ${requiredPermission}.` }],
      })
      return jsonOk(c, { userMessage: serializeMessage(userMessage), message: serializeMessage(assistantMessage) })
    }
    const values = extractDraftValues(workflow, body.message)
    if (typeof values.bloodGroup === 'string') {
      const [group] = await db.select({ id: bloodGroups.id }).from(bloodGroups).where(eq(bloodGroups.code, values.bloodGroup)).limit(1)
      if (group) values.bloodGroupId = group.id
      delete values.bloodGroup
    }
    const validation = validateDraftValues(workflow, values)
    const draft = await createAssistantDraft(db, {
      conversationId: id,
      ownerUserId: currentOwner.userId,
      workflow,
      values: validation.values,
      missingFields: validation.missingFields,
      errors: validation.errors,
    })
    const formBlock = await buildDraftFormBlock(db, {
      draftId: draft.id,
      workflow,
      values: draft.valuesJson,
      missingFields: draft.missingFieldsJson,
      errors: draft.errorsJson,
      language,
    })
    const assistantMessage = await addAssistantMessage(db, {
      conversationId: id,
      ownerUserId: currentOwner.userId,
      role: 'ASSISTANT',
      language,
      blocks: [
        { type: 'text', content: language === 'sw' ? 'Kagua na ujaze taarifa zinazokosekana kabla ya kuthibitisha.' : 'Review the details and complete the missing fields before confirmation.' },
        formBlock,
      ],
    })
    return jsonOk(c, { userMessage: serializeMessage(userMessage), message: serializeMessage(assistantMessage) }, 201)
  }

  const history = conversationState.messages.slice(-10).flatMap((message) => {
    const text = Array.isArray(message.blocksJson)
      ? message.blocksJson.flatMap((block) => block.type === 'text'
        ? [block.content]
        : block.type === 'composition'
          ? [`${block.title}: ${block.summary}`]
          : block.type === 'notice'
            ? [`${block.title ?? 'Notice'}: ${block.message}`]
            : []).join('\n')
      : undefined
    return typeof text === 'string'
      ? [{ role: message.role === 'USER' ? 'user' as const : 'assistant' as const, content: text }]
      : []
  })
  const permissions = filterKnownPermissionCodes(c.get('permissions') ?? [], PERMISSION_CODES)
  const toolSession = assistantToolSessionStore.create({
    ...currentOwner,
    permissions,
    requestId: c.get('requestId') ?? null,
    facilityId: requireHospitalFacilityId(c.get('user'), c.get('roles')),
  })
  const origin = new URL(c.req.url).origin
  const env = getEnv()
  const toolsOrigin = env.API_INTERNAL_BASE_URL ?? origin
  const result = await handleAssistantMessage(db, { ...body, history }, permissions, {
    aiClient: createAiClient(env),
    toolSession,
    toolsUrl: `${toolsOrigin.replace(/\/+$/, '')}/api/v1/assistant/tools`,
  })
  let blocks = legacyResultBlocks(result)
  let artifactId: string | undefined
  let suggestions: string[] | undefined
  if (result.type === 'answer' && result.unavailableCode) {
    await auditAssistant(c, 'assistant.unavailable', {
      reason: result.unavailableCode,
      stage: result.unavailableStage ?? 'unknown',
      retryable: result.retryable ?? true,
    })
  }
  if (result.type === 'composed_answer') {
    try {
      const executions = await executeCompositionSources(db, toolSession, result.sources)
      const composition = resolveAssistantComposition(result.composition, executions)
      blocks = [previewAssistantComposition(composition)]
      suggestions = result.composition.suggestions
      if (explicitlyRequestsReport(body.message)) {
        if (!hasCurrentPermission(c, 'reports:read')) {
          blocks = [{ type: 'notice', tone: 'error', message: language === 'sw' ? 'Huna ruhusa ya kutengeneza ripoti.' : 'Your account does not have reports:read.' }]
        } else {
          const requiredPermissions = [...new Set(['reports:read', ...compositionRequiredPermissions(executions)])]
          const snapshot: AssistantCompositionSnapshot = {
            version: 2,
            reportType: 'dynamic',
            title: composition.title,
            generatedAt: new Date().toISOString(),
            language,
            summary: composition.summary,
            prompt: body.message,
            filters: { sources: result.sources.map((source) => ({ sourceId: source.sourceId, tool: source.tool, arguments: source.arguments })) },
            queryPlan: result.sources,
            requiredPermissions,
            compositionPlan: result.composition,
            composition,
          }
          const artifact = await createAssistantArtifact(db, {
            conversationId: id,
            ownerUserId: currentOwner.userId,
            reportType: 'dynamic',
            title: composition.title,
            requiredPermission: 'reports:read',
            facilityId: toolSession.facilityId,
            filters: snapshot.filters,
            snapshot: snapshot as unknown as Record<string, unknown>,
            language,
          })
          artifactId = artifact.id
          blocks.push({ type: 'report', reportId: artifact.id, reportType: 'dynamic', title: composition.title, generatedAt: snapshot.generatedAt, summary: composition.summary, filters: snapshot.filters, formats: ['pdf', 'csv'], csvSections: compositionCsvSections(composition) })
          await auditAssistant(c, 'assistant.report_generated', { reportId: artifact.id, reportType: 'dynamic' })
        }
      }
    } catch (error) {
      const reason = AppError.isAppError(error) ? ` (${error.message.slice(0, 240)})` : ''
      logWarn('Assistant composition failed', { reason: AppError.isAppError(error) ? error.message.slice(0, 300) : 'INVALID_COMPOSITION' })
      blocks = [{ type: 'notice', tone: 'error', title: language === 'sw' ? 'Msaidizi wa AI haupatikani' : 'AI assistant unavailable', message: language === 'sw' ? `Mpangilio wa majibu haukuweza kuthibitishwa${reason}. Tafadhali jaribu tena.` : `The generated data layout could not be validated${reason}. Please try again.` }]
      await auditAssistant(c, 'assistant.composition_failed', { reason: AppError.isAppError(error) ? error.code : 'INVALID_COMPOSITION' })
    }
  }
  if (result.type === 'action_proposal') {
    const payload = result.proposal.action === 'notification.send' || result.proposal.action === 'inventory.update'
      ? { ...result.proposal.payload, actorUserId: currentOwner.userId }
      : result.proposal.payload
    const persisted = await persistAssistantProposal(db, { ...result.proposal, payload }, currentOwner, id)
    blocks = [
      { type: 'text', content: result.message },
      { type: 'action_proposal', proposal: { ...result.proposal, payload }, expiresAt: persisted.expiresAt.toISOString() },
    ]
  }
  const assistantMessage = await addAssistantMessage(db, {
    conversationId: id,
    ownerUserId: currentOwner.userId,
    role: 'ASSISTANT',
    language,
    blocks,
    suggestions,
  })
  return jsonOk(c, {
    userMessage: serializeMessage(userMessage),
    message: serializeMessage(assistantMessage),
    ...(artifactId ? { artifactId } : {}),
    ...(result.type === 'navigation' ? { navigation: { path: result.path } } : {}),
  }, 201)
})

assistantRoutes.patch('/drafts/:id', async (c) => {
  requireAssistantStaff(c)
  const { id } = parseParams(c, assistantDraftParamSchema)
  const body = await parseJsonBody(c, updateAssistantDraftBodySchema)
  const currentOwner = owner(c)
  const db = getDb()
  const existing = await getAssistantDraft(db, id, currentOwner.userId)
  const workflow = existing.workflow as AssistantDraftWorkflow
  const validation = validateDraftValues(workflow, { ...existing.valuesJson, ...body.values })
  const draft = await updateAssistantDraft(db, id, currentOwner.userId, validation)
  const conversation = await getAssistantConversation(db, draft.conversationId, currentOwner.userId)
  const block = await buildDraftFormBlock(db, {
    draftId: draft.id,
    workflow,
    values: draft.valuesJson,
    missingFields: draft.missingFieldsJson,
    errors: draft.errorsJson,
    language: conversation.preferredLanguage,
  })
  return jsonOk(c, { draft: { id: draft.id, valid: validation.success }, block })
})

assistantRoutes.post('/drafts/:id/prepare', async (c) => {
  requireAssistantStaff(c)
  const { id } = parseParams(c, assistantDraftParamSchema)
  const currentOwner = owner(c)
  const db = getDb()
  const draft = await getAssistantDraft(db, id, currentOwner.userId)
  const workflow = draft.workflow as AssistantDraftWorkflow
  const requiredPermission = workflowPermission(workflow)
  if (!hasCurrentPermission(c, requiredPermission)) throw AppError.forbidden(`Assistant workflow requires ${requiredPermission}`)
  const validation = validateDraftValues(workflow, draft.valuesJson)
  if (!validation.success) {
    const updated = await updateAssistantDraft(db, id, currentOwner.userId, validation)
    const conversation = await getAssistantConversation(db, draft.conversationId, currentOwner.userId)
    const block = await buildDraftFormBlock(db, {
      draftId: updated.id,
      workflow,
      values: updated.valuesJson,
      missingFields: updated.missingFieldsJson,
      errors: updated.errorsJson,
      language: conversation.preferredLanguage,
    })
    return jsonOk(c, { valid: false, block })
  }
  const facilityId = requireHospitalFacilityId(c.get('user'), c.get('roles'))
  const values = { ...validation.values }
  if (typeof facilityId === 'number' && (workflow === 'donation.create' || workflow === 'blood_request.create')) values.facilityId = facilityId
  const actionMap = {
    'donor.create': 'donor.create',
    'donation.create': 'donation.create',
    'blood_request.create': 'blood_request.create',
  } as const
  const proposal = createAssistantProposal(
    actionMap[workflow],
    requiredPermission,
    workflow === 'donor.create' ? 'Register donor' : workflow === 'donation.create' ? 'Record donation' : 'Create blood request',
    'Create this record using the reviewed information.',
    { ...values, actorUserId: currentOwner.userId },
    'Creates the operational record and records an audit event after confirmation.',
  )
  const persisted = await persistAssistantProposal(db, proposal, currentOwner, draft.conversationId)
  await auditAssistant(c, AssistantAuditActions.PROPOSED, {
    actionId: proposal.id,
    assistantAction: proposal.action,
    requiredPermission,
  })
  return jsonOk(c, {
    valid: true,
    block: { type: 'action_proposal', proposal, expiresAt: persisted.expiresAt.toISOString() },
  })
})

assistantRoutes.get('/reports/:id', async (c) => {
  requireAssistantStaff(c)
  const { id } = parseParams(c, assistantReportParamSchema)
  const currentOwner = owner(c)
  const artifact = await getAssistantArtifact(getDb(), id, currentOwner.userId)
  await assertArtifactAccess(c, artifact)
  return jsonOk(c, {
    report: {
      id: artifact.id,
      reportType: artifact.reportType,
      title: artifact.title,
      filters: artifact.filtersJson,
      snapshot: artifact.snapshotJson,
      generatedAt: artifact.createdAt.toISOString(),
      expiresAt: artifact.expiresAt.toISOString(),
    },
  })
})

assistantRoutes.post('/reports/:id/refresh', async (c) => {
  requireAssistantStaff(c)
  const { id } = parseParams(c, assistantReportParamSchema)
  const currentOwner = owner(c)
  const db = getDb()
  const source = await getAssistantArtifact(db, id, currentOwner.userId)
  await assertArtifactAccess(c, source)
  const stored = source.snapshotJson as unknown as AssistantReportSnapshot | AssistantCompositionSnapshot
  let snapshot: AssistantReportSnapshot | AssistantCompositionSnapshot
  let blocks: AssistantBlock[]
  if (stored.version === 2) {
    const permissions = filterKnownPermissionCodes(c.get('permissions') ?? [], PERMISSION_CODES)
    const toolSession = assistantToolSessionStore.create({
      ...currentOwner,
      permissions,
      requestId: c.get('requestId') ?? null,
      facilityId: requireHospitalFacilityId(c.get('user'), c.get('roles')),
    })
    const executions = await executeCompositionSources(db, toolSession, stored.queryPlan)
    const composition = resolveAssistantComposition(stored.compositionPlan, executions)
    snapshot = {
      ...stored,
      generatedAt: new Date().toISOString(),
      requiredPermissions: [...new Set(['reports:read', ...compositionRequiredPermissions(executions)])],
      composition,
    }
    blocks = [previewAssistantComposition(composition)]
  } else {
    snapshot = await buildAssistantReport(db, {
      reportType: source.reportType as AssistantReportType,
      filters: source.filtersJson,
      language: source.language,
      user: c.get('user'),
      roles: c.get('roles') ?? [],
    })
    blocks = reportSnapshotBlocks(snapshot, 'pending')
  }
  const refreshed = await createAssistantArtifact(db, {
    conversationId: source.conversationId,
    ownerUserId: currentOwner.userId,
    reportType: source.reportType,
    title: snapshot.title,
    requiredPermission: source.requiredPermission,
    facilityId: source.facilityId,
    filters: snapshot.filters,
    snapshot: snapshot as unknown as Record<string, unknown>,
    language: source.language,
  })
  if (snapshot.version === 2) {
    blocks.push({ type: 'report', reportId: refreshed.id, reportType: 'dynamic', title: snapshot.title, generatedAt: snapshot.generatedAt, summary: snapshot.summary, filters: snapshot.filters, formats: ['pdf', 'csv'], csvSections: compositionCsvSections(snapshot.composition) })
  } else {
    blocks = reportSnapshotBlocks(snapshot, refreshed.id)
  }
  const message = await addAssistantMessage(db, {
    conversationId: source.conversationId,
    ownerUserId: currentOwner.userId,
    role: 'ASSISTANT',
    language: source.language,
    blocks,
  })
  await auditAssistant(c, 'assistant.report_refreshed', { reportId: refreshed.id, sourceReportId: source.id })
  return jsonOk(c, { reportId: refreshed.id, message: serializeMessage(message) }, 201)
})

assistantRoutes.get('/reports/:id/export', async (c) => {
  requireAssistantStaff(c)
  const { id } = parseParams(c, assistantReportParamSchema)
  const query = parseQuery(c, assistantReportExportQuerySchema)
  const currentOwner = owner(c)
  const artifact = await getAssistantArtifact(getDb(), id, currentOwner.userId)
  await assertArtifactAccess(c, artifact)
  const snapshot = artifact.snapshotJson as unknown as AssistantReportSnapshot | AssistantCompositionSnapshot
  const filename = `${artifact.reportType}-${artifact.id}.${query.format}`
  await auditAssistant(c, 'assistant.report_exported', { reportId: artifact.id, format: query.format, section: query.section })
  if (query.format === 'csv') {
    return c.body(renderAssistantReportCsv(snapshot, query.section), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    })
  }
  const pdf = renderAssistantReportPdf(snapshot)
  const pdfBody = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer
  return c.body(pdfBody, 200, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${filename}"`,
  })
})

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
    facilityId: requireHospitalFacilityId(c.get('user'), c.get('roles')),
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
      result.proposal.action === 'notification.send' || result.proposal.action === 'inventory.update'
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
  const proposal = await consumeAssistantProposal(getDb(), id, currentOwner) ?? assistantActionStore.take(id, currentOwner)
  if (!proposal) {
    throw AppError.notFound('Assistant action expired or is not available for this session')
  }

  await auditAssistant(c, AssistantAuditActions.CONFIRMED, {
    actionId: proposal.id,
    assistantAction: proposal.action,
    requiredPermission: proposal.requiredPermission,
  })

  try {
    await assertProposalFacilityScope(c, proposal as AssistantActionProposal)
    const result = await executeAssistantAction(
      getDb(),
      proposal as AssistantActionProposal,
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
    await markAssistantProposalFailed(getDb(), proposal.id).catch(() => undefined)
    await auditAssistant(c, AssistantAuditActions.FAILED, {
      actionId: proposal.id,
      assistantAction: proposal.action,
      requiredPermission: proposal.requiredPermission,
      error: error instanceof Error ? error.message : 'unknown',
    })
    throw error
  }
})

assistantRoutes.post('/actions/:id/cancel', async (c) => {
  const { id } = parseParams(c, assistantActionParamSchema)
  const currentOwner = owner(c)
  const cancelled = await cancelAssistantProposal(getDb(), id, currentOwner)
  if (!cancelled) throw AppError.notFound('Assistant action expired or is not available for this session')
  await auditAssistant(c, 'assistant.action_cancelled', { actionId: id })
  return jsonOk(c, { type: 'action_cancelled', actionId: id })
})
