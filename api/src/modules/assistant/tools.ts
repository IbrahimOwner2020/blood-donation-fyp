import { z } from 'zod'

import type { Db } from '../../db/client'
import { AppError } from '../../lib/errors'
import type { PermissionCode } from '../../lib/permissions'
import { parseWithSchema } from '../../lib/validate'
import {
  dashboardAlertsQuerySchema,
  dashboardPredictionsQuerySchema,
  dashboardSummaryQuerySchema,
  dashboardTrendQuerySchema,
} from '../dashboard/schemas'
import {
  getDashboardAlerts,
  getDashboardPredictions,
  getDashboardSummary,
  getDemandTrend,
  getDonationTrend,
  getInventoryTrend,
} from '../dashboard/service'
import { donorIdParamSchema, listDonorsQuerySchema } from '../donors/schemas'
import { getDonorById, listDonors } from '../donors/service'
import { donationIdParamSchema, listDonationsQuerySchema } from '../donations/schemas'
import { getDonationById, listDonations } from '../donations/service'
import { alertIdParamSchema, listAlertsQuerySchema, patchAlertStatusBodySchema, recalculateAlertsBodySchema } from '../alerts/schemas'
import { getAlertById, listAlerts } from '../alerts/service'
import { inventoryIdParamSchema, listInventoryQuerySchema, updateInventoryBodySchema } from '../inventory/schemas'
import { getInventoryById, listInventory } from '../inventory/service'
import { previewNotificationsBodySchema, sendNotificationsBodySchema } from '../notifications/schemas'
import { runPredictionBodySchema } from '../predictions/schemas'
import {
  createAssistantProposal,
  type AssistantActionName,
  type AssistantActionProposal,
} from './service'
import { assistantActionStore } from './action-store'
import type { AssistantToolSession } from './tool-session-store'

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
    description: 'Read dashboard KPIs and blood-group inventory distribution.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema(),
    schema: dashboardSummaryQuerySchema.passthrough(),
    handler: async (args, { db }) => getDashboardSummary(db, dashboardSummaryQuerySchema.parse(args)),
  },
  {
    name: 'dashboard.trends',
    description: 'Read dashboard inventory, donation, and demand trends for the same filters.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema(),
    schema: dashboardTrendQuerySchema.passthrough(),
    handler: async (args, { db }) => {
      const query = dashboardTrendQuerySchema.parse(args)
      const [inventory, donations, demand] = await Promise.all([
        getInventoryTrend(db, query),
        getDonationTrend(db, query),
        getDemandTrend(db, query),
      ])
      return { inventory, donations, demand }
    },
  },
  {
    name: 'dashboard.predictions',
    description: 'Read latest dashboard prediction snapshots.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema(),
    schema: dashboardPredictionsQuerySchema.passthrough(),
    handler: async (args, { db }) => getDashboardPredictions(db, dashboardPredictionsQuerySchema.parse(args)),
  },
  {
    name: 'dashboard.alerts',
    description: 'Read recent dashboard shortage alerts.',
    requiredPermission: 'reports:read',
    mutates: false,
    inputSchema: jsonSchema(),
    schema: dashboardAlertsQuerySchema.passthrough(),
    handler: async (args, { db }) => getDashboardAlerts(db, dashboardAlertsQuerySchema.parse(args)),
  },
  {
    name: 'donors.search',
    description: 'Search donor records by query, status, blood group, or centre.',
    requiredPermission: 'donors:read',
    mutates: false,
    inputSchema: jsonSchema({ q: { type: 'string' }, bloodGroup: { type: 'string' }, limit: { type: 'number' } }),
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
    inputSchema: jsonSchema({ donorId: { type: 'number' }, bloodGroup: { type: 'string' }, limit: { type: 'number' } }),
    schema: listDonationsQuerySchema.passthrough(),
    handler: async (args, { db }) => listDonations(db, listDonationsQuerySchema.parse({ limit: 10, ...args })),
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
    inputSchema: jsonSchema({ status: { type: 'string' }, bloodGroup: { type: 'string' }, limit: { type: 'number' } }),
    schema: listInventoryQuerySchema.passthrough(),
    handler: async (args, { db }) => listInventory(db, listInventoryQuerySchema.parse({ limit: 10, ...args })),
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
    name: 'alerts.search',
    description: 'Search shortage alerts by blood group, facility, status, or severity.',
    requiredPermission: 'alerts:read',
    mutates: false,
    inputSchema: jsonSchema({ status: { type: 'string' }, severity: { type: 'string' }, bloodGroup: { type: 'string' } }),
    schema: listAlertsQuerySchema.passthrough(),
    handler: async (args, { db }) => listAlerts(db, listAlertsQuerySchema.parse({ limit: 10, ...args })),
  },
  {
    name: 'alerts.get',
    description: 'Read one shortage alert by id.',
    requiredPermission: 'alerts:read',
    mutates: false,
    inputSchema: jsonSchema({ id: { type: 'number' } }),
    schema: idSchema,
    handler: async (args, { db }) => getAlertById(db, alertIdParamSchema.parse(args).id),
  },
  {
    name: 'alerts.propose_recalculate',
    description: 'Create a confirmation proposal to recalculate shortage alerts.',
    requiredPermission: 'alerts:update',
    mutates: true,
    inputSchema: jsonSchema({ predictionId: { type: 'number' }, bloodGroup: { type: 'string' }, facilityId: { type: 'number' } }),
    schema: recalculateAlertsBodySchema,
    handler: async (args, context) => {
      const body = recalculateAlertsBodySchema.parse(args)
      return proposalResult(
        context,
        'alert.recalculate',
        'alerts:update',
        'Recalculate shortage alerts',
        body.bloodGroup ? `Recalculate alerts for ${body.bloodGroup}.` : 'Recalculate alerts from the latest prediction data.',
        body,
        'Creates, updates, or resolves shortage alerts according to API gap rules after confirmation.',
      )
    },
  },
  {
    name: 'alerts.propose_status_update',
    description: 'Create a confirmation proposal to change a shortage alert status.',
    requiredPermission: 'alerts:update',
    mutates: true,
    inputSchema: jsonSchema({ alertId: { type: 'number' }, status: { type: 'string' } }),
    schema: z.object({
      alertId: z.coerce.number().int().positive(),
      status: patchAlertStatusBodySchema.shape.status,
    }),
    handler: async (args, context) => {
      const alertId = z.coerce.number().int().positive().parse(args.alertId)
      const body = patchAlertStatusBodySchema.parse(args)
      return proposalResult(
        context,
        'alert.status',
        'alerts:update',
        `Set alert #${alertId} to ${body.status}`,
        `Change shortage alert #${alertId} status to ${body.status}.`,
        { alertId, status: body.status },
        'Updates the alert lifecycle after confirmation.',
      )
    },
  },
  {
    name: 'predictions.propose_run',
    description: 'Create a confirmation proposal to run a blood-demand forecast.',
    requiredPermission: 'predictions:run',
    mutates: true,
    inputSchema: jsonSchema({ bloodGroup: { type: 'string' }, horizonDays: { type: 'number' }, facilityId: { type: 'number' } }),
    schema: runPredictionBodySchema,
    handler: async (args, context) => {
      const body = runPredictionBodySchema.parse(args)
      return proposalResult(
        context,
        'prediction.run',
        'predictions:run',
        `Run ${body.horizonDays ?? 7}-day forecast for ${body.bloodGroup}`,
        `Create a new prediction for blood group ${body.bloodGroup}.`,
        body,
        'Calls the prediction service and evaluates shortage gaps after confirmation.',
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
    inputSchema: jsonSchema({ path: { type: 'string' }, label: { type: 'string' } }),
    schema: z.object({
      path: z.string().trim().min(1).max(300),
      label: z.string().trim().min(1).max(120).optional(),
      requiredPermission: z.string().trim().min(1).max(80).optional(),
    }),
    handler: async (args, context) => {
      const parsed = z.object({
        path: z.string().trim().min(1).max(300),
        label: z.string().trim().min(1).max(120).optional(),
        requiredPermission: z.string().trim().min(1).max(80).optional(),
      }).parse(args)
      ensureToolPermission(context.session, parsed.requiredPermission as PermissionCode | undefined)
      return {
        type: 'navigation',
        path: parsed.path,
        message: `Opening ${parsed.label ?? parsed.path}.`,
        requiredPermission: parsed.requiredPermission,
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
  const parsedArgs = parseWithSchema(tool.schema, args, `assistant tool ${name}`)
  return tool.handler(parsedArgs, { db, session })
}
