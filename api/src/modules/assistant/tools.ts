import { z } from 'zod'
import { and, desc, eq, gte, lte } from 'drizzle-orm'

import type { Db } from '../../db/client'
import { aiPredictions, bloodGroups, healthcareFacilities } from '../../db/schema'
import { AppError } from '../../lib/errors'
import type { PermissionCode } from '../../lib/permissions'
import { parseWithSchema } from '../../lib/validate'
import { donorIdParamSchema, listDonorsQuerySchema } from '../donors/schemas'
import { getDonorById, listDonors } from '../donors/service'
import { donationIdParamSchema, listDonationsQuerySchema } from '../donations/schemas'
import { getDonationById, listDonations } from '../donations/service'
import {
  bloodRequestIdParamSchema,
  bloodRequestPrioritySchema,
  bloodRequestStatusSchema,
  listBloodRequestsQuerySchema,
} from '../blood-requests/schemas'
import { getBloodRequestById, listBloodRequests } from '../blood-requests/service'
import {
  inventoryIdParamSchema,
  inventoryStatusSchema,
  listInventoryQuerySchema,
  updateInventoryBodySchema,
} from '../inventory/schemas'
import { getInventoryById, listInventory } from '../inventory/service'
import { previewNotificationsBodySchema, sendNotificationsBodySchema } from '../notifications/schemas'
import { dashboardSummaryQuerySchema, dashboardTrendQuerySchema } from '../dashboard/schemas'
import {
  getDashboardAlerts,
  getDashboardSummary,
  getDemandTrend,
  getDonationTrend,
  getInventoryTrend,
} from '../dashboard/service'
import { dashboardAlertsQuerySchema } from '../dashboard/schemas'
import { alertIdParamSchema, alertSeveritySchema, alertStatusSchema, listAlertsQuerySchema } from '../alerts/schemas'
import { getAlertById, listAlerts } from '../alerts/service'
import { aiAnalysisIdParamSchema, listAiAnalysisQuerySchema, runAiAnalysisBodySchema } from '../ai-analysis/schemas'
import { getAiAnalysisById, listAiAnalysisRuns } from '../ai-analysis/service'
import {
  getBloodRequestsReport,
  getDonationsReport,
  getDonorEligibilityReport,
  getInventoryReport,
  getNotificationsReport,
} from '../reports/service'
import {
  bloodRequestsReportQuerySchema,
  donationsReportQuerySchema,
  donorEligibilityReportQuerySchema,
  inventoryReportQuerySchema,
  notificationsReportQuerySchema,
} from '../reports/schemas'
import {
  createAssistantProposal,
  type AssistantActionName,
  type AssistantActionProposal,
} from './service'
import { assistantActionStore } from './action-store'
import type { AssistantToolSession } from './tool-session-store'
import {
  ASSISTANT_NAVIGATION_PATHS,
  resolveAssistantNavigationLabel,
  resolveAssistantNavigationTarget,
} from './navigation'

export type AssistantToolDescriptor = {
  name: string
  description: string
  requiredPermission?: PermissionCode
  mutates: boolean
  inputSchema: Record<string, unknown>
}

type ToolContext = {
  db: Db
  session: AssistantToolSession
}

type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<unknown>

type ToolDefinition = AssistantToolDescriptor & {
  schema: z.ZodTypeAny
  handler: ToolHandler
}

const emptySchema = z.object({}).passthrough()
const idSchema = z.object({ id: z.coerce.number().int().positive() })
const predictionHistorySchema = z.object({
  bloodGroup: z.string().trim().max(4).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  facilityId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).passthrough()

const navigationArgsSchema = z.object({
  path: z.string().trim().min(1).max(300).optional(),
  label: z.string().trim().min(1).max(120).optional(),
}).refine((value) => Boolean(value.path || value.label), { message: 'path is required', path: ['path'] })

const BLOOD_GROUP_CODES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const
const bloodGroupInputSchema = {
  type: 'string',
  enum: [...BLOOD_GROUP_CODES],
  description: 'A concrete blood group code. Omit this field to include all blood groups.',
}

function jsonSchema(properties: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    additionalProperties: false,
  }
}

function hasPermission(session: AssistantToolSession, code: PermissionCode): boolean {
  return session.permissions.includes(code)
}

function ensureToolPermission(session: AssistantToolSession, code?: PermissionCode): void {
  if (code && !hasPermission(session, code)) {
    throw AppError.forbidden(`Assistant tool requires ${code}`)
  }
}

function proposalResult(
  context: ToolContext,
  action: AssistantActionName,
  requiredPermission: PermissionCode,
  title: string,
  description: string,
  payload: Record<string, unknown>,
  effect: string,
): { proposal: AssistantActionProposal } {
  ensureToolPermission(context.session, requiredPermission)
  const proposal = createAssistantProposal(
    action,
    requiredPermission,
    title,
    description,
    payload,
    effect,
  )
  return {
    proposal: assistantActionStore.put(proposal, {
      userId: context.session.userId,
      sessionId: context.session.sessionId,
    }),
  }
}

const toolDefinitions: ToolDefinition[] = [
  {
    name: 'dashboard.summary',
    description: 'Read API-authoritative blood supply KPIs for a date range and optional blood group.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ from: { type: 'string' }, to: { type: 'string' }, bloodGroup: bloodGroupInputSchema }),
    schema: dashboardSummaryQuerySchema.passthrough(),
    handler: async (args, { db, session }) => getDashboardSummary(db, dashboardSummaryQuerySchema.parse({ ...args, ...(session.facilityId ? { facilityId: session.facilityId } : {}) })),
  },
  {
    name: 'dashboard.trends',
    description: 'Read inventory, donation, and demand trend series from the API.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ from: { type: 'string' }, to: { type: 'string' }, bloodGroup: bloodGroupInputSchema }),
    schema: dashboardTrendQuerySchema.passthrough(),
    handler: async (args, { db, session }) => {
      const query = dashboardTrendQuerySchema.parse({ ...args, ...(session.facilityId ? { facilityId: session.facilityId } : {}) })
      const [inventory, donations, demand] = await Promise.all([
        getInventoryTrend(db, query),
        getDonationTrend(db, query),
        getDemandTrend(db, query),
      ])
      return { inventory, donations, demand }
    },
  },
  {
    name: 'dashboard.alerts',
    description: 'Read recent shortage alerts for an operational overview.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ activeOnly: { type: 'boolean' }, limit: { type: 'number' } }),
    schema: dashboardAlertsQuerySchema.passthrough(),
    handler: async (args, { db, session }) => getDashboardAlerts(db, dashboardAlertsQuerySchema.parse({ ...args, ...(session.facilityId ? { facilityId: session.facilityId } : {}) })),
  },
  {
    name: 'reports.inventory',
    description: 'Read authoritative inventory report totals and blood-group rows for a point in time.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ asOf: { type: 'string' }, bloodGroup: bloodGroupInputSchema }),
    schema: inventoryReportQuerySchema.passthrough(),
    handler: async (args, { db, session }) => getInventoryReport(db, inventoryReportQuerySchema.parse({ ...args, ...(session.facilityId ? { facilityId: session.facilityId } : {}) })),
  },
  {
    name: 'reports.blood_requests',
    description: 'Read blood-request totals, blood-group breakdowns, and daily request trends.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ from: { type: 'string' }, to: { type: 'string' }, bloodGroup: bloodGroupInputSchema }),
    schema: bloodRequestsReportQuerySchema.passthrough(),
    handler: async (args, { db, session }) => getBloodRequestsReport(db, bloodRequestsReportQuerySchema.parse({ ...args, ...(session.facilityId ? { facilityId: session.facilityId } : {}) })),
  },
  {
    name: 'reports.donations',
    description: 'Read donation totals, blood-group breakdowns, and daily donation trends.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ from: { type: 'string' }, to: { type: 'string' }, bloodGroup: bloodGroupInputSchema }),
    schema: donationsReportQuerySchema.passthrough(),
    handler: async (args, { db, session }) => {
      if (session.facilityId) throw AppError.forbidden('Donation reporting is unavailable for facility-scoped accounts')
      return getDonationsReport(db, donationsReportQuerySchema.parse(args))
    },
  },
  {
    name: 'reports.donor_eligibility',
    description: 'Read donor eligibility totals and report-safe donor rows without contact details.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ bloodGroup: bloodGroupInputSchema }),
    schema: donorEligibilityReportQuerySchema.passthrough(),
    handler: async (args, { db, session }) => {
      if (session.facilityId) throw AppError.forbidden('Donor eligibility reporting is unavailable for facility-scoped accounts')
      return getDonorEligibilityReport(db, donorEligibilityReportQuerySchema.parse(args))
    },
  },
  {
    name: 'reports.notifications',
    description: 'Read notification totals and breakdowns by delivery status and channel.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ from: { type: 'string' }, to: { type: 'string' }, bloodGroup: bloodGroupInputSchema, channel: { type: 'string' }, status: { type: 'string' } }),
    schema: notificationsReportQuerySchema.passthrough(),
    handler: async (args, { db, session }) => {
      if (session.facilityId) throw AppError.forbidden('Notification reporting is unavailable for facility-scoped accounts')
      return getNotificationsReport(db, notificationsReportQuerySchema.parse(args))
    },
  },
  {
    name: 'predictions.history',
    description: 'Read stored prediction history, model labels, periods, predicted units, and metrics. Demo baseline records are explicitly labelled by model name and version.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ bloodGroup: bloodGroupInputSchema, from: { type: 'string' }, to: { type: 'string' }, facilityId: { type: 'number' }, limit: { type: 'number' } }),
    schema: predictionHistorySchema,
    handler: async (args, { db, session }) => {
      const query = predictionHistorySchema.parse({ ...args, ...(session.facilityId ? { facilityId: session.facilityId } : {}) })
      const conditions = [
        ...(query.bloodGroup ? [eq(bloodGroups.code, query.bloodGroup)] : []),
        ...(query.from ? [gte(aiPredictions.forecastStart, new Date(`${query.from}T00:00:00.000Z`))] : []),
        ...(query.to ? [lte(aiPredictions.forecastEnd, new Date(`${query.to}T23:59:59.999Z`))] : []),
        ...(query.facilityId ? [eq(aiPredictions.facilityId, query.facilityId)] : []),
      ]
      const items = await db.select({
        id: aiPredictions.id,
        bloodGroup: bloodGroups.code,
        facilityId: aiPredictions.facilityId,
        facility: healthcareFacilities.name,
        forecastStart: aiPredictions.forecastStart,
        forecastEnd: aiPredictions.forecastEnd,
        predictedUnits: aiPredictions.predictedUnits,
        modelName: aiPredictions.modelName,
        modelVersion: aiPredictions.modelVersion,
        metrics: aiPredictions.metricsJson,
        createdAt: aiPredictions.createdAt,
      }).from(aiPredictions)
        .innerJoin(bloodGroups, eq(aiPredictions.bloodGroupId, bloodGroups.id))
        .leftJoin(healthcareFacilities, eq(aiPredictions.facilityId, healthcareFacilities.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(aiPredictions.createdAt))
        .limit(query.limit)
      return { items, total: items.length }
    },
  },
  {
    name: 'donors.search',
    description: 'Search donor records by query, status, blood group, or centre.',
    requiredPermission: 'donors:read',
    mutates: false,
    inputSchema: jsonSchema({ q: { type: 'string' }, bloodGroup: bloodGroupInputSchema, limit: { type: 'number' } }),
    schema: listDonorsQuerySchema.passthrough(),
    handler: async (args, { db }) => listDonors(db, listDonorsQuerySchema.parse({ limit: 10, ...args })),
  },
  {
    name: 'donors.get',
    description: 'Read one donor record by id.',
    requiredPermission: 'donors:read',
    mutates: false,
    inputSchema: jsonSchema({ id: { type: 'number' } }),
    schema: idSchema,
    handler: async (args, { db }) => getDonorById(db, donorIdParamSchema.parse(args).id),
  },
  {
    name: 'donations.search',
    description: 'Search donation records by donor, centre, blood group, and date window.',
    requiredPermission: 'donations:read',
    mutates: false,
    inputSchema: jsonSchema({ donorId: { type: 'number' }, bloodGroup: bloodGroupInputSchema, limit: { type: 'number' } }),
    schema: listDonationsQuerySchema.passthrough(),
    handler: async (args, { db, session }) => listDonations(db, listDonationsQuerySchema.parse({ limit: 10, ...args, ...(session.facilityId ? { facilityId: session.facilityId } : {}) })),
  },
  {
    name: 'donations.get',
    description: 'Read one donation record by id.',
    requiredPermission: 'donations:read',
    mutates: false,
    inputSchema: jsonSchema({ id: { type: 'number' } }),
    schema: idSchema,
    handler: async (args, { db }) => getDonationById(db, donationIdParamSchema.parse(args).id),
  },
  {
    name: 'inventory.search',
    description: 'Search inventory units by status, blood group, facility, donation, or expiry.',
    requiredPermission: 'inventory:read',
    mutates: false,
    inputSchema: jsonSchema({ status: { type: 'string', enum: [...inventoryStatusSchema.options] }, bloodGroup: bloodGroupInputSchema, limit: { type: 'number' } }),
    schema: listInventoryQuerySchema.passthrough(),
    handler: async (args, { db, session }) => listInventory(db, listInventoryQuerySchema.parse({ limit: 10, ...args, ...(session.facilityId ? { facilityId: session.facilityId } : {}) })),
  },
  {
    name: 'inventory.get',
    description: 'Read one inventory unit by id.',
    requiredPermission: 'inventory:read',
    mutates: false,
    inputSchema: jsonSchema({ id: { type: 'number' } }),
    schema: idSchema,
    handler: async (args, { db }) => getInventoryById(db, inventoryIdParamSchema.parse(args).id),
  },
  {
    name: 'inventory.propose_update',
    description: 'Create a confirmation proposal to update inventory status or facility.',
    requiredPermission: 'inventory:update',
    mutates: true,
    inputSchema: jsonSchema({ inventoryId: { type: 'number' }, status: { type: 'string' }, facilityId: { type: 'number' } }),
    schema: z.object({
      inventoryId: z.coerce.number().int().positive(),
      status: updateInventoryBodySchema.shape.status,
      facilityId: z.coerce.number().int().positive().nullable().optional(),
    }),
    handler: async (args, context) => {
      const body = updateInventoryBodySchema.parse(args)
      const inventoryId = z.coerce.number().int().positive().parse(args.inventoryId)
      return proposalResult(
        context,
        'inventory.update',
        'inventory:update',
        `Update inventory unit #${inventoryId}`,
        `Change inventory unit #${inventoryId}${body.status ? ` status to ${body.status}` : ''}${body.facilityId !== undefined ? ` and facility to ${body.facilityId ?? 'unassigned'}` : ''}.`,
        { inventoryId, ...body },
        'Updates the inventory record after confirmation.',
      )
    },
  },
  {
    name: 'blood_requests.search',
    description: 'Search blood requests by facility, status, priority, or blood group.',
    requiredPermission: 'requests:read',
    mutates: false,
    inputSchema: jsonSchema({
      status: { type: 'string', enum: [...bloodRequestStatusSchema.options] },
      priority: { type: 'string', enum: [...bloodRequestPrioritySchema.options] },
      bloodGroupId: { type: 'number' },
      limit: { type: 'number' },
    }),
    schema: listBloodRequestsQuerySchema.passthrough(),
    handler: async (args, { db, session }) => listBloodRequests(db, listBloodRequestsQuerySchema.parse({ limit: 10, ...args, ...(session.facilityId ? { facilityId: session.facilityId } : {}) })),
  },
  {
    name: 'blood_requests.get',
    description: 'Read one blood request by id.',
    requiredPermission: 'requests:read',
    mutates: false,
    inputSchema: jsonSchema({ id: { type: 'number' } }),
    schema: idSchema,
    handler: async (args, { db }) => getBloodRequestById(db, bloodRequestIdParamSchema.parse(args).id),
  },
  {
    name: 'alerts.search',
    description: 'Search predicted shortage alerts by blood group, severity, status, or facility.',
    requiredPermission: 'alerts:read',
    mutates: false,
    inputSchema: jsonSchema({
      bloodGroup: bloodGroupInputSchema,
      severity: { type: 'string', enum: [...alertSeveritySchema.options] },
      status: { type: 'string', enum: [...alertStatusSchema.options] },
      activeOnly: { type: 'boolean' },
      limit: { type: 'number' },
    }),
    schema: listAlertsQuerySchema.passthrough(),
    handler: async (args, { db, session }) => listAlerts(db, listAlertsQuerySchema.parse({ limit: 10, ...args, ...(session.facilityId ? { facilityId: session.facilityId } : {}) })),
  },
  {
    name: 'alerts.get',
    description: 'Read one predicted shortage alert by id.',
    requiredPermission: 'alerts:read',
    mutates: false,
    inputSchema: jsonSchema({ id: { type: 'number' } }),
    schema: idSchema,
    handler: async (args, { db }) => getAlertById(db, alertIdParamSchema.parse(args).id),
  },
  {
    name: 'ai_analysis.search',
    description: 'Read recent scheduled or manual AI supply analysis reports.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ limit: { type: 'number' }, notificationMode: { type: 'string' } }),
    schema: listAiAnalysisQuerySchema.passthrough(),
    handler: async (args, { db }) => listAiAnalysisRuns(db, listAiAnalysisQuerySchema.parse(args)),
  },
  {
    name: 'ai_analysis.get',
    description: 'Read one AI supply analysis report by id.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema({ id: { type: 'number' } }),
    schema: idSchema,
    handler: async (args, { db }) => getAiAnalysisById(db, aiAnalysisIdParamSchema.parse(args).id),
  },
  {
    name: 'ai_analysis.propose_run',
    description: 'Create a confirmation proposal for a 7, 14, 30, or 60 day AI supply analysis. Defaults to report-only.',
    requiredPermission: 'reports:read',
    mutates: true,
    inputSchema: jsonSchema({ horizonDays: { type: 'number' }, notificationMode: { type: 'string' } }),
    schema: runAiAnalysisBodySchema,
    handler: async (args, context) => {
      const body = runAiAnalysisBodySchema.parse({ notificationMode: 'REPORT_ONLY', ...args })
      if (body.notificationMode !== 'REPORT_ONLY') ensureToolPermission(context.session, 'notifications:send')
      return proposalResult(
        context,
        'ai_analysis.run',
        'reports:read',
        `Run ${body.horizonDays}-day AI analysis`,
        `Generate an AI supply analysis using ${body.notificationMode} mode.`,
        { ...body, actorUserId: context.session.userId },
        body.notificationMode === 'REPORT_ONLY'
          ? 'Generates and stores an analysis report without sending notifications.'
          : 'May prepare or send notifications according to the selected mode after confirmation.',
      )
    },
  },
  {
    name: 'notifications.propose_preview',
    description: 'Create a confirmation proposal to preview donor notifications without sending.',
    requiredPermission: 'notifications:read',
    mutates: true,
    inputSchema: jsonSchema({ donorIds: { type: 'array' }, channel: { type: 'string' }, alertId: { type: 'number' } }),
    schema: previewNotificationsBodySchema.passthrough(),
    handler: async (args, context) => {
      const body = previewNotificationsBodySchema.parse(args)
      return proposalResult(
        context,
        'notification.preview',
        'notifications:read',
        `Preview ${body.channel} to ${body.donorIds.length} donor${body.donorIds.length === 1 ? '' : 's'}`,
        `Preview ${body.channel} notifications for donor ids ${body.donorIds.join(', ')}.`,
        body,
        'Composes notification copy without sending messages after confirmation.',
      )
    },
  },
  {
    name: 'notifications.propose_send',
    description: 'Create a confirmation proposal to send donor notifications.',
    requiredPermission: 'notifications:send',
    mutates: true,
    inputSchema: jsonSchema({ donorIds: { type: 'array' }, channel: { type: 'string' }, alertId: { type: 'number' } }),
    schema: sendNotificationsBodySchema.passthrough(),
    handler: async (args, context) => {
      const body = sendNotificationsBodySchema.parse(args)
      return proposalResult(
        context,
        'notification.send',
        'notifications:send',
        `Send ${body.channel} to ${body.donorIds.length} donor${body.donorIds.length === 1 ? '' : 's'}`,
        `Send ${body.channel} notifications for donor ids ${body.donorIds.join(', ')}.`,
        { ...body, actorUserId: context.session.userId },
        'Sends notifications through the configured provider after confirmation.',
      )
    },
  },
  {
    name: 'navigation.propose',
    description: 'Return a permitted in-app navigation target.',
    mutates: false,
    inputSchema: jsonSchema({
      path: { type: 'string', enum: [...ASSISTANT_NAVIGATION_PATHS] },
      label: { type: 'string' },
    }),
    schema: navigationArgsSchema,
    handler: async (args, context) => {
      const parsed = navigationArgsSchema.parse(args)
      const target = parsed.path
        ? resolveAssistantNavigationTarget(parsed.path)
        : resolveAssistantNavigationLabel(parsed.label)
      if (!target) {
        throw AppError.badRequest('Assistant navigation target is not available')
      }
      ensureToolPermission(context.session, target.permission)
      return {
        type: 'navigation',
        path: target.path,
        message: `Opening ${parsed.label ?? target.label}.`,
        ...(target.permission ? { requiredPermission: target.permission } : {}),
      }
    },
  },
]

const toolMap = new Map(toolDefinitions.map((tool) => [tool.name, tool]))

export function listAssistantTools(
  session?: AssistantToolSession,
): AssistantToolDescriptor[] {
  return toolDefinitions
    .filter((tool) => !tool.requiredPermission || !session || hasPermission(session, tool.requiredPermission))
    .map(({ schema: _schema, handler: _handler, ...tool }) => tool)
}

export async function callAssistantTool(
  db: Db,
  session: AssistantToolSession,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = toolMap.get(name)
  if (!tool) {
    throw AppError.notFound(`Assistant tool "${name}" is not available`)
  }
  ensureToolPermission(session, tool.requiredPermission)
  const normalizedArgs = normalizeAssistantToolArgs(args)
  parseWithSchema(tool.schema, normalizedArgs, `assistant tool ${name}`)
  // Handlers parse their own input; parsed output (e.g. boolean flags) is not valid input to re-parse.
  return tool.handler(normalizedArgs, { db, session })
}

const QUERY_BOOLEAN_KEYS = ['activeOnly', 'availableOnly'] as const
const UPPERCASE_ENUM_KEYS = ['status', 'priority', 'severity', 'channel', 'notificationMode'] as const
const MAX_TOOL_LIMIT = 100

export function normalizeAssistantToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const normalized = Object.fromEntries(
    Object.entries(args ?? {}).filter(([, value]) => value !== null && !(typeof value === 'string' && !value.trim())),
  )
  const limit = Number(normalized.limit)
  if (normalized.limit !== undefined && Number.isFinite(limit)) {
    normalized.limit = Math.min(Math.max(Math.trunc(limit), 1), MAX_TOOL_LIMIT)
  }
  for (const key of QUERY_BOOLEAN_KEYS) {
    if (typeof normalized[key] === 'boolean') {
      normalized[key] = normalized[key] ? 'true' : 'false'
    }
  }
  for (const key of UPPERCASE_ENUM_KEYS) {
    const value = normalized[key]
    if (typeof value === 'string') {
      normalized[key] = value.trim().toUpperCase()
    }
  }
  const bloodGroup = normalized.bloodGroup
  if (bloodGroup === null || bloodGroup === undefined) {
    delete normalized.bloodGroup
  } else if (typeof bloodGroup === 'string') {
    const value = bloodGroup.trim().toUpperCase()
    if (!value || value === 'ALL' || value === 'ANY' || value === '*') {
      delete normalized.bloodGroup
    } else {
      normalized.bloodGroup = value
    }
  }
  return normalized
}

export function sanitizeAssistantToolResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAssistantToolResult)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(?:phone|email|password|secret|token|hash|contact)/i.test(key))
      .map(([key, nested]) => [key, sanitizeAssistantToolResult(nested)]),
  )
}
