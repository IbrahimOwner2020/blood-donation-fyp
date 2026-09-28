import { AppError } from '../../lib/errors'
import { logWarn } from '../../lib/logger'
import { PERMISSION_CODES, type PermissionCode } from '../../lib/permissions'
import type { Db } from '../../db/client'
import { previewNotifications, sendNotifications } from '../notifications/service'
import {
  previewNotificationsBodySchema,
  sendNotificationsBodySchema,
} from '../notifications/schemas'
import { updateInventoryUnit } from '../inventory/service'
import { updateInventoryBodySchema } from '../inventory/schemas'
import { createDonor } from '../donors/service'
import { createDonorBodySchema } from '../donors/schemas'
import { createDonation } from '../donations/service'
import { createDonationBodySchema } from '../donations/schemas'
import { createBloodRequest } from '../blood-requests/service'
import { createBloodRequestBodySchema } from '../blood-requests/schemas'
import { runAiAnalysis } from '../ai-analysis/service'
import { runAiAnalysisBodySchema } from '../ai-analysis/schemas'
import {
  BloodRequestAuditActions,
  DonationAuditActions,
  DonorAuditActions,
  InventoryAuditActions,
  recordActivity,
} from '../../services/audit'
import type { AiServiceClient } from '../../services/ai'
import type { AssistantCompositionPlan, AssistantDataSource, AssistantMessageBody } from './schemas'
import { assistantResultSchema } from './schemas'
import type { AssistantToolSession } from './tool-session-store'
import {
  ASSISTANT_NAVIGATION_TARGETS,
  resolveAssistantNavigationTarget,
} from './navigation'

type PermissionSet = readonly string[]

export type AssistantActionName =
  | 'donor.create'
  | 'donation.create'
  | 'blood_request.create'
  | 'notification.preview'
  | 'notification.send'
  | 'inventory.update'
  | 'ai_analysis.run'

export type AssistantActionProposal = {
  id: string
  action: AssistantActionName
  title: string
  description: string
  requiredPermission: PermissionCode
  payload: Record<string, unknown>
  effect: string
}

export type AssistantResult =
  | {
      type: 'answer'
      message: string
      unavailableCode?: string
      unavailableStage?: 'tools' | 'provider' | 'planning' | 'data' | 'composition'
      retryable?: boolean
    }
  | {
      type: 'navigation'
      message: string
      path: string
      requiredPermission?: PermissionCode
    }
  | {
      type: 'permission_denied'
      message: string
      requiredPermission: PermissionCode
    }
  | {
      type: 'action_proposal'
      message: string
      proposal: AssistantActionProposal
    }
  | {
      type: 'composed_answer'
      message: string
      sources: AssistantDataSource[]
      composition: AssistantCompositionPlan
    }

export type ExecuteAssistantActionResult = {
  message: string
  action: AssistantActionName
  data: unknown
}

export const AssistantAuditActions = {
  PROPOSED: 'assistant.action_proposed',
  CONFIRMED: 'assistant.action_confirmed',
  DENIED: 'assistant.permission_denied',
  FAILED: 'assistant.action_failed',
  COMPLETED: 'assistant.action_completed',
} as const

const VALID_PERMISSION_CODES = new Set<string>(PERMISSION_CODES)

type AssistantUnavailableResult = Extract<AssistantResult, { type: 'answer' }>

function aiUnavailable(
  code: string,
  stage: NonNullable<AssistantUnavailableResult['unavailableStage']>,
  message: string,
): AssistantUnavailableResult {
  return { type: 'answer', message, unavailableCode: code, unavailableStage: stage, retryable: true }
}

function describeAiFailure(error: unknown): AssistantUnavailableResult {
  if (AppError.isAppError(error)) {
    const aiCode = error.details?.[0]?.code ?? ''
    if (aiCode === 'AI_TIMEOUT') {
      return aiUnavailable(
        'AI_TIMEOUT',
        'provider',
        'The AI assistant took longer than the API timeout (AI_REQUEST_TIMEOUT_MS). Please retry the request.',
      )
    }
    if (aiCode === 'AI_INVALID_RESPONSE') {
      return aiUnavailable('AI_INVALID_RESPONSE', 'provider', 'The AI service returned a response the API could not read. Please retry the request.')
    }
    if (aiCode && aiCode !== 'AI_SERVICE_UNAVAILABLE') {
      return aiUnavailable(aiCode.slice(0, 80), 'provider', `The AI service failed: ${error.message.slice(0, 300)}`)
    }
  }
  return aiUnavailable(
    'AI_SERVICE_UNAVAILABLE',
    'provider',
    'The API could not reach the AI assistant. Check the AI service and try again.',
  )
}

function hasPermission(permissions: PermissionSet, code: PermissionCode): boolean {
  return permissions.includes(code)
}

function ensurePermission(permissions: PermissionSet, code: PermissionCode): void {
  if (!hasPermission(permissions, code)) {
    throw AppError.forbidden(`Assistant action requires ${code}`)
  }
}

function deny(code: PermissionCode): AssistantResult {
  return {
    type: 'permission_denied',
    requiredPermission: code,
    message: `Your account does not include ${code}, so I cannot perform that action.`,
  }
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function randomId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `act_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

function extractPositiveInt(text: string, names: string[]): number | undefined {
  for (const name of names) {
    const pattern = new RegExp(`${name}\\s*#?\\s*(\\d+)`, 'i')
    const match = text.match(pattern)
    const parsed = match?.[1] ? Number.parseInt(match[1], 10) : NaN
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return undefined
}

function extractBloodGroup(text: string): string | undefined {
  const match = text.toUpperCase().match(/(^|[^A-Z0-9])((?:AB|A|B|O)[+-])(?=$|[^A-Z0-9])/)
  return match?.[2]
}

function extractHorizonDays(text: string): 7 | 14 | 30 | 60 | undefined {
  const match = text.match(/\b(7|14|30|60)\s*(day|days)?\b/i)
  const value = match?.[1] ? Number.parseInt(match[1], 10) : undefined
  return value === 7 || value === 14 || value === 30 || value === 60 ? value : undefined
}

function extractAlertStatus(text: string): 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED' | undefined {
  const value = normalizeText(text)
  if (/\backnowledge(d)?\b/.test(value)) return 'ACKNOWLEDGED'
  if (/\bresolve(d)?\b/.test(value)) return 'RESOLVED'
  if (/\bdismiss(ed)?\b/.test(value)) return 'DISMISSED'
  if (/\breopen\b|\bopen\b/.test(value)) return 'OPEN'
  return undefined
}

function extractInventoryStatus(text: string): 'AVAILABLE' | 'RESERVED' | 'ISSUED' | 'EXPIRED' | 'DISCARDED' | undefined {
  const value = normalizeText(text)
  if (/\bavailable\b/.test(value)) return 'AVAILABLE'
  if (/\breserved?\b/.test(value)) return 'RESERVED'
  if (/\bissued?\b/.test(value)) return 'ISSUED'
  if (/\bexpired?\b/.test(value)) return 'EXPIRED'
  if (/\bdiscard(ed)?\b/.test(value)) return 'DISCARDED'
  return undefined
}

function extractDonorIds(text: string): number[] {
  const match = text.match(/donors?\s+((?:#?\d+[\s,]*(?:and)?\s*)+)/i)
  const source = match?.[1] ?? ''
  const ids = Array.from(source.matchAll(/\d+/g))
    .map((m) => Number.parseInt(m[0], 10))
    .filter((id) => Number.isFinite(id) && id > 0)
  return Array.from(new Set(ids)).slice(0, 100)
}

function extractChannel(text: string): 'SMS' | 'EMAIL' | undefined {
  const value = normalizeText(text)
  if (/\bemail\b/.test(value)) return 'EMAIL'
  if (/\bsms\b|\btext\b/.test(value)) return 'SMS'
  return undefined
}

export function createAssistantProposal(
  action: AssistantActionName,
  requiredPermission: PermissionCode,
  title: string,
  description: string,
  payload: Record<string, unknown>,
  effect: string,
): AssistantActionProposal {
  return {
    id: randomId(),
    action,
    requiredPermission,
    title,
    description,
    payload,
    effect,
  }
}

function maybeNavigation(message: string, permissions: PermissionSet): AssistantResult | null {
  const text = normalizeText(message)
  if (!/\b(open|show|go to|take me to|navigate|view)\b/.test(text)) {
    return null
  }

  const target = ASSISTANT_NAVIGATION_TARGETS.find((item) =>
    item.keywords.some((keyword) => text.includes(keyword)),
  )
  if (!target) {
    return null
  }
  if (target.permission && !hasPermission(permissions, target.permission)) {
    return deny(target.permission)
  }
  return {
    type: 'navigation',
    path: target.path,
    requiredPermission: target.permission,
    message: `Opening ${target.label}.`,
  }
}

function maybeAction(message: string, permissions: PermissionSet): AssistantResult | null {
  const text = normalizeText(message)
  const original = message.trim()


  if (/\b(send|notify|preview|draft|compose)\b/.test(text) && /\b(notification|notifications|donor|donors|sms|email|text)\b/.test(text)) {
    const isSend = /\b(send|notify)\b/.test(text) && !/\bpreview|draft|compose\b/.test(text)
    const requiredPermission = isSend ? 'notifications:send' : 'notifications:read'
    if (!hasPermission(permissions, requiredPermission)) return deny(requiredPermission)
    const donorIds = extractDonorIds(original)
    const channel = extractChannel(original)
    if (!donorIds.length || !channel) {
      return { type: 'answer', message: 'Please include donor ids and a channel, for example: send SMS to donors 4, 8 for alert 2.' }
    }
    const alertId = extractPositiveInt(original, ['alert'])
    const action = isSend ? 'notification.send' : 'notification.preview'
    return {
      type: 'action_proposal',
      message: isSend ? 'I can send those notifications after you confirm.' : 'I can preview those notifications after you confirm.',
      proposal: createAssistantProposal(
        action,
        requiredPermission,
        `${isSend ? 'Send' : 'Preview'} ${channel} to ${donorIds.length} donor${donorIds.length === 1 ? '' : 's'}`,
        `${isSend ? 'Send' : 'Preview'} ${channel} notifications for donor ids ${donorIds.join(', ')}.`,
        { donorIds, channel, alertId },
        isSend ? 'Sends notifications through the configured provider and persists results.' : 'Composes notification copy without sending messages.',
      ),
    }
  }

  if (/\b(inventory|unit)\b/.test(text) && /\b(mark|set|update|move|assign)\b/.test(text)) {
    const requiredPermission = 'inventory:update'
    if (!hasPermission(permissions, requiredPermission)) return deny(requiredPermission)
    const inventoryId = extractPositiveInt(original, ['inventory', 'unit'])
    const status = extractInventoryStatus(original)
    const facilityId = extractPositiveInt(original, ['facility'])
    if (!inventoryId || (!status && !facilityId)) {
      return { type: 'answer', message: 'Please include the inventory unit id and the status or facility to update.' }
    }
    return {
      type: 'action_proposal',
      message: 'I can update that inventory unit after you confirm.',
      proposal: createAssistantProposal(
        'inventory.update',
        requiredPermission,
        `Update inventory unit #${inventoryId}`,
        `Change inventory unit #${inventoryId}${status ? ` status to ${status}` : ''}${facilityId ? ` and facility to #${facilityId}` : ''}.`,
        { inventoryId, status, facilityId },
        'Updates the inventory record and records an audit event.',
      ),
    }
  }

  return null
}

function dashboardFilterPath(body: AssistantMessageBody): string | null {
  const filters = body.context?.filters
  if (!filters || typeof filters !== 'object') {
    return null
  }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (['from', 'to', 'bloodGroup'].includes(key) && typeof value === 'string' && value.trim()) {
      params.set(key, value.trim())
    }
  }
  const query = params.toString()
  return query ? `/dashboard?${query}` : null
}

export async function handleAssistantMessage(
  db: Db,
  body: AssistantMessageBody,
  permissions: PermissionSet,
  options: {
    aiClient?: Pick<AiServiceClient, 'chat'>
    toolSession?: AssistantToolSession
    toolsUrl?: string
  } = {},
): Promise<AssistantResult> {
  let aiFailure: AssistantUnavailableResult | null = null
  if (options.aiClient && options.toolSession && options.toolsUrl) {
    try {
      const aiResult = await options.aiClient.chat({
        message: body.message,
        context: body.context,
        history: body.history,
        permissions: [...permissions],
        toolSessionToken: options.toolSession.token,
        toolsUrl: options.toolsUrl,
      })
      const validation = assistantResultSchema.safeParse(aiResult)
      if (!validation.success) {
        const issue = validation.error.issues?.[0]
        const path = issue?.path?.length ? issue.path.map(String).join('.') : 'response'
        const detail = `${path}: ${issue?.message ?? 'Invalid value'}`.slice(0, 300)
        const resultType = (aiResult as { type?: unknown } | null)?.type
        logWarn('Assistant AI response failed API validation', {
          resultType: typeof resultType === 'string' ? resultType : 'unknown',
          issueCount: validation.error.issues?.length ?? 0,
          detail,
        })
        aiFailure = aiUnavailable(
          'ASSISTANT_RESPONSE_INVALID',
          resultType === 'composed_answer' ? 'composition' : 'planning',
          `The AI response did not match the API contract (${detail}). Please retry or rephrase the request.`,
        )
      } else {
        const parsedResult = validation.data as AssistantResult
        if (parsedResult.type !== 'navigation') {
          return parsedResult
        }

        const target = resolveAssistantNavigationTarget(parsedResult.path)
        if (!target) {
          throw new Error('Assistant returned an unknown navigation target')
        }
        if (target.permission && !hasPermission(permissions, target.permission)) {
          return deny(target.permission)
        }
        return {
          type: 'navigation',
          message: parsedResult.message,
          path: target.path,
          ...(target.permission ? { requiredPermission: target.permission } : {}),
        }
      }
    } catch (error) {
      // Controlled navigation and mutation proposals retain deterministic local
      // handling. Data layouts never fall back to fixed report templates.
      aiFailure = describeAiFailure(error)
      logWarn('Assistant AI chat failed', {
        code: aiFailure.unavailableCode,
        reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
      })
    }
  }

  const nav = maybeNavigation(body.message, permissions)
  if (nav) return nav

  const action = maybeAction(body.message, permissions)
  if (action) return action

  const text = normalizeText(body.message)
  if (/\b(filter|apply|period|from|to|blood group)\b/.test(text)) {
    if (!hasPermission(permissions, 'reports:read')) return deny('reports:read')
    const path = dashboardFilterPath(body)
    if (path) {
      return {
        type: 'navigation',
        path,
        requiredPermission: 'reports:read',
        message: 'Applying the dashboard filters.',
      }
    }
  }

  return aiFailure ?? describeAiFailure(null)
}

export async function executeAssistantAction(
  db: Db,
  proposal: AssistantActionProposal,
  permissions: PermissionSet,
): Promise<ExecuteAssistantActionResult> {
  if (!VALID_PERMISSION_CODES.has(proposal.requiredPermission)) {
    throw AppError.forbidden('Assistant action has an invalid permission mapping')
  }
  ensurePermission(permissions, proposal.requiredPermission)

  switch (proposal.action) {
    case 'donor.create': {
      const actorId = Number(proposal.payload.actorUserId)
      const { actorUserId: _actorUserId, ...input } = proposal.payload
      const body = createDonorBodySchema.parse(input)
      const result = await createDonor(db, body)
      await recordActivity({
        actorUserId: Number.isFinite(actorId) ? actorId : null,
        action: DonorAuditActions.CREATE,
        entityType: 'donor',
        entityId: result.id,
        metadata: { donorNumber: result.donorNumber, bloodGroupId: result.bloodGroupId },
      })
      return {
        action: proposal.action,
        message: `Donor ${result.donorNumber} was registered.`,
        data: { donor: result },
      }
    }
    case 'donation.create': {
      const actorId = Number(proposal.payload.actorUserId)
      if (!Number.isFinite(actorId) || actorId < 1) throw AppError.unauthorized('Authenticated user required')
      const { actorUserId: _actorUserId, ...input } = proposal.payload
      const body = createDonationBodySchema.parse(input)
      const result = await createDonation(db, body, actorId)
      await recordActivity({
        actorUserId: actorId,
        action: DonationAuditActions.CREATE,
        entityType: 'donation',
        entityId: result.id,
        metadata: { donorId: result.donorId, bloodGroupId: result.bloodGroupId, units: result.units },
      })
      return {
        action: proposal.action,
        message: `Donation #${result.id} was recorded and inventory was created.`,
        data: { donation: result },
      }
    }
    case 'blood_request.create': {
      const actorId = Number(proposal.payload.actorUserId)
      if (!Number.isFinite(actorId) || actorId < 1) throw AppError.unauthorized('Authenticated user required')
      const { actorUserId: _actorUserId, ...input } = proposal.payload
      const body = createBloodRequestBodySchema.parse(input)
      const result = await createBloodRequest(db, body, actorId)
      await recordActivity({
        actorUserId: actorId,
        action: BloodRequestAuditActions.CREATE,
        entityType: 'blood_request',
        entityId: result.id,
        metadata: { facilityId: result.facilityId, bloodGroupId: result.bloodGroupId, unitsRequested: result.unitsRequested },
      })
      return {
        action: proposal.action,
        message: `Blood request #${result.id} was created.`,
        data: { bloodRequest: result },
      }
    }
    case 'notification.preview': {
      const body = previewNotificationsBodySchema.parse(proposal.payload)
      const result = await previewNotifications(db, body)
      return {
        action: proposal.action,
        message: `Prepared ${result.composedCount} notification preview${result.composedCount === 1 ? '' : 's'}.`,
        data: result,
      }
    }
    case 'notification.send': {
      const actorId = proposal.payload.actorUserId
      if (typeof actorId !== 'number') {
        throw AppError.unauthorized('Authenticated user required')
      }
      const { actorUserId: _actorUserId, ...body } = proposal.payload
      const parsed = sendNotificationsBodySchema.parse(body)
      const result = await sendNotifications(db, parsed, actorId)
      return {
        action: proposal.action,
        message: `Sent ${result.sentCount} notification${result.sentCount === 1 ? '' : 's'}; ${result.failedCount} failed.`,
        data: result,
      }
    }
    case 'inventory.update': {
      const inventoryId = Number(proposal.payload.inventoryId)
      const body = updateInventoryBodySchema.parse({
        status: proposal.payload.status,
        facilityId:
          typeof proposal.payload.facilityId === 'number'
            ? proposal.payload.facilityId
            : undefined,
      })
      const result = await updateInventoryUnit(db, inventoryId, body)
      const actorId = Number(proposal.payload.actorUserId)
      await recordActivity({
        actorUserId: Number.isFinite(actorId) ? actorId : null,
        action: InventoryAuditActions.UPDATE,
        entityType: 'blood_inventory',
        entityId: result.unit.id,
        metadata: { status: result.unit.status, facilityId: result.unit.facilityId },
      })
      return {
        action: proposal.action,
        message: `Inventory unit #${result.unit.id} was updated.`,
        data: result,
      }
    }
    case 'ai_analysis.run': {
      const actorId = Number(proposal.payload.actorUserId)
      if (!Number.isFinite(actorId) || actorId < 1) throw AppError.unauthorized('Authenticated user required')
      const body = runAiAnalysisBodySchema.parse({
        horizonDays: proposal.payload.horizonDays,
        notificationMode: proposal.payload.notificationMode ?? 'REPORT_ONLY',
      })
      if (body.notificationMode !== 'REPORT_ONLY') ensurePermission(permissions, 'notifications:send')
      const result = await runAiAnalysis(db, {
        triggerType: 'USER',
        horizonDays: body.horizonDays,
        notificationMode: body.notificationMode ?? 'REPORT_ONLY',
        actor: { userId: actorId },
      })
      return {
        action: proposal.action,
        message: `AI analysis #${result.id} completed with status ${result.status}.`,
        data: { report: result },
      }
    }
  }
}
