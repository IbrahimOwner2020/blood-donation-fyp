import { AppError } from '../../lib/errors'
import { PERMISSION_CODES, type PermissionCode } from '../../lib/permissions'
import type { Db } from '../../db/client'
import { getDashboardSummary } from '../dashboard/service'
import { dashboardSummaryQuerySchema } from '../dashboard/schemas'
import { runPrediction } from '../predictions/service'
import { afterPredictionPersisted } from '../alerts/hooks'
import { recalculateAlerts, patchAlertStatus } from '../alerts/service'
import {
  patchAlertStatusBodySchema,
  recalculateAlertsBodySchema,
  listAlertsQuerySchema,
} from '../alerts/schemas'
import { listAlerts } from '../alerts/service'
import { listDonations } from '../donations/service'
import { listDonationsQuerySchema } from '../donations/schemas'
import { listDonors } from '../donors/service'
import { listDonorsQuerySchema } from '../donors/schemas'
import { listInventory } from '../inventory/service'
import { listInventoryQuerySchema } from '../inventory/schemas'
import { previewNotifications, sendNotifications } from '../notifications/service'
import {
  previewNotificationsBodySchema,
  sendNotificationsBodySchema,
} from '../notifications/schemas'
import { updateInventoryUnit } from '../inventory/service'
import { updateInventoryBodySchema } from '../inventory/schemas'
import { runPredictionBodySchema } from '../predictions/schemas'
import type { AiServiceClient } from '../../services/ai'
import type { AssistantMessageBody } from './schemas'
import { assistantResultSchema } from './schemas'
import type { AssistantToolSession } from './tool-session-store'

type PermissionSet = readonly string[]

export type AssistantActionName =
  | 'prediction.run'
  | 'alert.recalculate'
  | 'alert.status'
  | 'notification.preview'
  | 'notification.send'
  | 'inventory.update'

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

const NAV_TARGETS: Array<{
  keywords: string[]
  path: string
  label: string
  permission?: PermissionCode
}> = [
  { keywords: ['dashboard', 'overview', 'home'], path: '/dashboard', label: 'dashboard', permission: 'reports:read' },
  { keywords: ['alert', 'alerts', 'shortage'], path: '/alerts', label: 'alerts', permission: 'alerts:read' },
  { keywords: ['donor', 'donors'], path: '/donors', label: 'donors', permission: 'donors:read' },
  { keywords: ['donation', 'donations'], path: '/donations', label: 'donations', permission: 'donations:read' },
  { keywords: ['inventory', 'stock', 'units'], path: '/inventory', label: 'inventory', permission: 'inventory:read' },
  { keywords: ['request', 'requests'], path: '/blood-requests', label: 'blood requests', permission: 'requests:read' },
  { keywords: ['forecast', 'forecasts', 'prediction', 'predictions'], path: '/predictions', label: 'forecasts', permission: 'predictions:read' },
  { keywords: ['notify', 'notification', 'notifications'], path: '/notifications', label: 'notifications', permission: 'notifications:read' },
  { keywords: ['report', 'reports'], path: '/reports', label: 'reports', permission: 'reports:read' },
  { keywords: ['users', 'user admin'], path: '/admin/users', label: 'users', permission: 'users:manage' },
  { keywords: ['roles', 'permissions'], path: '/admin/roles', label: 'roles', permission: 'roles:manage' },
  { keywords: ['activity', 'audit'], path: '/admin/activity', label: 'activity', permission: 'activity:read' },
]

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

function extractHorizonDays(text: string): 7 | 14 | 30 | undefined {
  const match = text.match(/\b(7|14|30)\s*(day|days)?\b/i)
  const value = match?.[1] ? Number.parseInt(match[1], 10) : undefined
  return value === 7 || value === 14 || value === 30 ? value : undefined
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

function isSystemReportRequest(message: string): boolean {
  const text = normalizeText(message)
  return (
    /\b(overall|general|system|operations?|operational|status|report|summary|overview)\b/.test(text) &&
    /\b(report|summary|overview|status|how are we|what is happening)\b/.test(text)
  )
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

  const target = NAV_TARGETS.find((item) =>
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

  if (/\b(run|create|generate)\b/.test(text) && /\b(prediction|forecast)\b/.test(text)) {
    const requiredPermission = 'predictions:run'
    if (!hasPermission(permissions, requiredPermission)) return deny(requiredPermission)
    const bloodGroup = extractBloodGroup(original)
    if (!bloodGroup) {
      return { type: 'answer', message: 'Which blood group should I run the prediction for? Include values like O+ or AB-.' }
    }
    const payload = {
      bloodGroup,
      horizonDays: extractHorizonDays(original) ?? 7,
      facilityId: extractPositiveInt(original, ['facility']),
    }
    return {
      type: 'action_proposal',
      message: 'I can run that forecast after you confirm.',
      proposal: createAssistantProposal(
        'prediction.run',
        requiredPermission,
        `Run ${payload.horizonDays}-day forecast for ${bloodGroup}`,
        `Create a new prediction for blood group ${bloodGroup}.`,
        payload,
        'Calls the prediction service, persists the forecast, and lets the alert hook evaluate shortage gaps.',
      ),
    }
  }

  if (/\b(recalculate|refresh|recompute)\b/.test(text) && /\b(alert|alerts|shortage)\b/.test(text)) {
    const requiredPermission = 'alerts:update'
    if (!hasPermission(permissions, requiredPermission)) return deny(requiredPermission)
    const payload = {
      predictionId: extractPositiveInt(original, ['prediction']),
      bloodGroup: extractBloodGroup(original),
      facilityId: extractPositiveInt(original, ['facility']),
    }
    return {
      type: 'action_proposal',
      message: 'I can recalculate shortage alerts after you confirm.',
      proposal: createAssistantProposal(
        'alert.recalculate',
        requiredPermission,
        'Recalculate shortage alerts',
        payload.bloodGroup ? `Recalculate alerts for ${payload.bloodGroup}.` : 'Recalculate alerts from the latest prediction data.',
        payload,
        'Creates, updates, or resolves shortage alerts according to API gap rules.',
      ),
    }
  }

  if (/\b(alert|alerts)\b/.test(text) && /\b(acknowledge|resolve|dismiss|reopen|open)\b/.test(text)) {
    const requiredPermission = 'alerts:update'
    if (!hasPermission(permissions, requiredPermission)) return deny(requiredPermission)
    const alertId = extractPositiveInt(original, ['alert'])
    const status = extractAlertStatus(original)
    if (!alertId || !status) {
      return { type: 'answer', message: 'Please include the alert id and target status, for example: acknowledge alert 12.' }
    }
    return {
      type: 'action_proposal',
      message: 'I can update that alert after you confirm.',
      proposal: createAssistantProposal(
        'alert.status',
        requiredPermission,
        `Set alert #${alertId} to ${status}`,
        `Change shortage alert #${alertId} status to ${status}.`,
        { alertId, status },
        'Updates the alert lifecycle and records an audit event.',
      ),
    }
  }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function itemsFrom(result: unknown): unknown[] {
  if (Array.isArray(result)) return result
  if (!isRecord(result)) return []
  for (const key of ['items', 'data', 'results', 'alerts', 'donations', 'donors', 'inventory']) {
    const value = result[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function totalFrom(result: unknown, items: unknown[]): number {
  if (!isRecord(result)) return items.length
  for (const key of ['total', 'totalItems', 'count']) {
    const value = result[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return items.length
}

function displayField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (value === null || value === undefined || value === '') return null
  if (isRecord(value)) {
    for (const nested of ['code', 'name', 'fullName', 'label', 'id']) {
      const nestedValue = value[nested]
      if (nestedValue !== null && nestedValue !== undefined && nestedValue !== '') {
        return String(nestedValue)
      }
    }
    return null
  }
  if (Array.isArray(value)) {
    return value.length ? value.slice(0, 3).map(String).join(', ') : null
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }
  return String(value)
}

function fieldLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim().toLowerCase()
}

function formatRecords(label: string, result: unknown, fields: string[]): string {
  const items = itemsFrom(result)
  const total = totalFrom(result, items)
  if (total === 0) return `No ${label} matched that request.`

  const rows = items.slice(0, 5).flatMap((item) => {
    if (!isRecord(item)) return []
    const id = displayField(item, 'id')
    const details = fields
      .map((field) => {
        const value = displayField(item, field)
        return value ? `${fieldLabel(field)} ${value}` : null
      })
      .filter((value): value is string => Boolean(value))
    return `${id ? `#${id}: ` : ''}${details.join(', ')}`
  })

  if (!rows.length) return `I found ${total} ${label}, but the records did not include displayable fields.`
  return `I found ${total} ${label}.${total > rows.length ? ` Showing ${rows.length}.` : ''}\n${rows.map((row) => `- ${row}`).join('\n')}`
}

async function maybeReadRecords(
  db: Db,
  message: string,
  permissions: PermissionSet,
): Promise<AssistantResult | null> {
  const text = normalizeText(message)
  if (!/\b(list|recent|search|find|show|summarize|summary|records?|units?|alerts?)\b/.test(text)) {
    return null
  }

  if (/\binventory\b|\bstock\b|\bunits?\b/.test(text)) {
    if (!hasPermission(permissions, 'inventory:read')) return deny('inventory:read')
    const result = await listInventory(db, listInventoryQuerySchema.parse({ limit: 10 }))
    return {
      type: 'answer',
      message: formatRecords('inventory units', result, ['bloodGroup', 'status', 'expiryDate', 'facilityId']),
    }
  }

  if (/\balerts?\b|\bshortage\b/.test(text)) {
    if (!hasPermission(permissions, 'alerts:read')) return deny('alerts:read')
    const result = await listAlerts(db, listAlertsQuerySchema.parse({ limit: 10 }))
    return {
      type: 'answer',
      message: formatRecords('alert records', result, ['bloodGroup', 'severity', 'status', 'gapUnits']),
    }
  }

  if (/\bdonations?\b/.test(text)) {
    if (!hasPermission(permissions, 'donations:read')) return deny('donations:read')
    const result = await listDonations(db, listDonationsQuerySchema.parse({ limit: 10 }))
    return {
      type: 'answer',
      message: formatRecords('donation records', result, ['donorId', 'bloodGroup', 'unitsCollected', 'donationDate', 'status']),
    }
  }

  if (/\bdonors?\b/.test(text)) {
    if (!hasPermission(permissions, 'donors:read')) return deny('donors:read')
    const result = await listDonors(db, listDonorsQuerySchema.parse({ limit: 10 }))
    return {
      type: 'answer',
      message: formatRecords('donor records', result, ['donorNumber', 'firstName', 'lastName', 'bloodGroup', 'eligibilityStatus', 'active']),
    }
  }

  return null
}

async function systemReport(
  db: Db,
  permissions: PermissionSet,
): Promise<AssistantResult> {
  const sections: string[] = []

  if (hasPermission(permissions, 'reports:read')) {
    const summary = await getDashboardSummary(db, dashboardSummaryQuerySchema.parse({}))
    sections.push(
      `Dashboard snapshot: ${summary.kpis.availableUnits} available units, ` +
        `${summary.kpis.lowStockGroupCount} low-stock groups, ` +
        `${summary.kpis.activeAlerts} active alerts, and ` +
        `${summary.kpis.donationsThisPeriod} donations in the selected period.`,
    )
  }

  if (hasPermission(permissions, 'alerts:read')) {
    const alerts = await listAlerts(db, listAlertsQuerySchema.parse({ limit: 5 }))
    sections.push(formatRecords('alert records', alerts, ['bloodGroup', 'severity', 'status', 'gapUnits']))
  }

  if (hasPermission(permissions, 'inventory:read')) {
    const inventory = await listInventory(db, listInventoryQuerySchema.parse({ limit: 5 }))
    sections.push(formatRecords('inventory units', inventory, ['bloodGroup', 'status', 'expiryDate', 'facilityId']))
  }

  if (hasPermission(permissions, 'donations:read')) {
    const donations = await listDonations(db, listDonationsQuerySchema.parse({ limit: 5 }))
    sections.push(formatRecords('donation records', donations, ['donorId', 'bloodGroup', 'unitsCollected', 'donationDate', 'status']))
  }

  if (hasPermission(permissions, 'donors:read')) {
    const donors = await listDonors(db, listDonorsQuerySchema.parse({ limit: 5 }))
    sections.push(formatRecords('donor records', donors, ['donorNumber', 'firstName', 'lastName', 'bloodGroup', 'eligibilityStatus', 'active']))
  }

  if (!sections.length) {
    return {
      type: 'permission_denied',
      requiredPermission: 'reports:read',
      message: 'Your account cannot access the operational data needed for an overall NBTS report.',
    }
  }

  return {
    type: 'answer',
    message: `Overall NBTS operational report:\n\n${sections.join('\n\n')}`,
  }
}

function contextualAnswer(body: AssistantMessageBody): AssistantResult {
  const path = body.context?.pathname?.trim()
  return {
    type: 'answer',
    message:
      `I need a more specific question${path ? ` for ${path}` : ''} to access the right NBTS data. Ask for a summary, a record id, a filter, or an action.`,
  }
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
  if (options.aiClient && options.toolSession && options.toolsUrl) {
    try {
      const aiResult = await options.aiClient.chat({
        message: body.message,
        context: body.context,
        permissions: [...permissions],
        toolSessionToken: options.toolSession.token,
        toolsUrl: options.toolsUrl,
      })
      return assistantResultSchema.parse(aiResult) as AssistantResult
    } catch {
      // Fall through to deterministic local handling when AI chat is unavailable
      // or returns an invalid control payload.
    }
  }

  const nav = maybeNavigation(body.message, permissions)
  if (nav) return nav

  const action = maybeAction(body.message, permissions)
  if (action) return action

  if (isSystemReportRequest(body.message)) {
    return systemReport(db, permissions)
  }

  const records = await maybeReadRecords(db, body.message, permissions)
  if (records) return records

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

  if (/\b(kpi|summary|dashboard|overview|available|low stock|alerts|donations)\b/.test(text)) {
    if (!hasPermission(permissions, 'reports:read')) return deny('reports:read')
    const summary = await getDashboardSummary(db, dashboardSummaryQuerySchema.parse({}))
    return {
      type: 'answer',
      message:
        `Dashboard snapshot: ${summary.kpis.availableUnits} available units, ` +
        `${summary.kpis.lowStockGroupCount} low-stock groups, ` +
        `${summary.kpis.activeAlerts} active alerts, and ` +
        `${summary.kpis.donationsThisPeriod} donations in the selected period.`,
    }
  }

  return contextualAnswer(body)
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
    case 'prediction.run': {
      const body = runPredictionBodySchema.parse(proposal.payload)
      const result = await runPrediction(db, body, { afterPredictionPersisted })
      return {
        action: proposal.action,
        message: `Forecast created for prediction #${result.prediction.id}.`,
        data: result,
      }
    }
    case 'alert.recalculate': {
      const body = recalculateAlertsBodySchema.parse(proposal.payload)
      const result = await recalculateAlerts(db, body)
      return {
        action: proposal.action,
        message: `Alert recalculation finished with ${result.results?.length ?? 0} result${result.results?.length === 1 ? '' : 's'}.`,
        data: result,
      }
    }
    case 'alert.status': {
      const alertId = Number(proposal.payload.alertId)
      const body = patchAlertStatusBodySchema.parse({
        status: proposal.payload.status,
      })
      const result = await patchAlertStatus(db, alertId, body)
      return {
        action: proposal.action,
        message: `Alert #${result.alert.id} is now ${result.alert.status}.`,
        data: result,
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
      return {
        action: proposal.action,
        message: `Inventory unit #${result.unit.id} was updated.`,
        data: result,
      }
    }
  }
}
