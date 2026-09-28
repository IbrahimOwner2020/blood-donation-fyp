/**
 * App assistant request contracts.
 * Natural-language parsing is intentionally bounded; execution remains API-owned.
 */

import { z } from 'zod'

const contextSchema = z
  .object({
    pathname: z.string().trim().max(300).optional(),
    search: z.string().trim().max(800).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .optional()

export const assistantMessageBodySchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, 'message is required')
      .max(2000, 'message must be at most 2000 characters'),
    context: contextSchema,
    history: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().trim().min(1).max(2000),
    })).max(10).optional().default([]),
  })
  .strict()

export type AssistantMessageBody = z.infer<typeof assistantMessageBodySchema>

export const assistantActionParamSchema = z.object({
  id: z.string().trim().min(12, 'Action id is invalid').max(120),
})

export type AssistantActionParam = z.infer<typeof assistantActionParamSchema>

const permissionCodeSchema = z.string().trim().min(1).max(80)

export const assistantLanguageSchema = z.enum(['en', 'sw'])

const assistantScalarSchema = z.union([
  z.string().max(4000),
  z.number(),
  z.boolean(),
  z.null(),
])

const assistantWidthSchema = z.enum(['full', 'half', 'third', 'two-thirds'])
const assistantFormatSchema = z.enum(['text', 'number', 'integer', 'percent', 'date', 'datetime'])

export const assistantDataSourceSchema = z.object({
  sourceId: z.string().regex(/^source_[a-z0-9_]+$/).max(64),
  tool: z.string().trim().min(1).max(120),
  arguments: z.record(z.string(), z.unknown()).default({}),
})

const assistantBindingSchema = z.object({
  sourceId: z.string().regex(/^source_[a-z0-9_]+$/).max(64),
  path: z.string().trim().max(240).default(''),
  operation: z.enum(['value', 'count', 'sum', 'average', 'minimum', 'maximum']).default('value'),
  field: z.string().trim().max(120).optional(),
})

const planBase = {
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(64),
  width: assistantWidthSchema.default('full'),
}

const assistantPlanBlockSchema = z.discriminatedUnion('type', [
  z.object({ ...planBase, type: z.literal('narrative'), content: z.string().trim().min(1).max(4000), sourceIds: z.array(z.string()).max(6).default([]) }),
  z.object({ ...planBase, type: z.literal('metrics'), title: z.string().trim().max(200).optional(), items: z.array(z.object({ label: z.string().trim().min(1).max(120), binding: assistantBindingSchema, format: assistantFormatSchema.optional(), comparison: z.string().trim().max(240).optional() })).min(1).max(12) }),
  z.object({ ...planBase, type: z.literal('comparison'), title: z.string().trim().min(1).max(200), label: z.string().trim().min(1).max(120), current: assistantBindingSchema, previous: assistantBindingSchema, mode: z.enum(['difference', 'percent_change']).default('difference'), format: assistantFormatSchema.optional() }),
  z.object({ ...planBase, type: z.literal('table'), title: z.string().trim().min(1).max(200), sourceId: z.string(), path: z.string().trim().max(240).default(''), columns: z.array(z.object({ key: z.string().trim().min(1).max(120), label: z.string().trim().min(1).max(120), format: assistantFormatSchema.optional() })).min(1).max(30), limit: z.number().int().min(1).max(10_000).default(200), sort: z.object({ key: z.string().trim().min(1).max(120), direction: z.enum(['asc', 'desc']) }).optional() }),
  z.object({ ...planBase, type: z.literal('chart'), title: z.string().trim().min(1).max(200), chartType: z.enum(['line', 'bar', 'stacked_bar', 'area', 'pie', 'donut']), sourceId: z.string(), path: z.string().trim().max(240).default(''), xKey: z.string().trim().min(1).max(120), series: z.array(z.object({ key: z.string().trim().min(1).max(120), label: z.string().trim().min(1).max(120) })).min(1).max(8) }),
  z.object({ ...planBase, type: z.literal('ranked_list'), title: z.string().trim().min(1).max(200), sourceId: z.string(), path: z.string().trim().max(240).default(''), labelKey: z.string().trim().min(1).max(120), valueKey: z.string().trim().min(1).max(120), limit: z.number().int().min(1).max(50).default(10), direction: z.enum(['asc', 'desc']).default('desc') }),
  z.object({ ...planBase, type: z.literal('status_summary'), title: z.string().trim().min(1).max(200), sourceId: z.string(), path: z.string().trim().max(240).default(''), labelKey: z.string().trim().min(1).max(120), valueKey: z.string().trim().min(1).max(120) }),
  z.object({ ...planBase, type: z.literal('timeline'), title: z.string().trim().min(1).max(200), sourceId: z.string(), path: z.string().trim().max(240).default(''), dateKey: z.string().trim().min(1).max(120), titleKey: z.string().trim().min(1).max(120), detailKey: z.string().trim().max(120).optional(), limit: z.number().int().min(1).max(100).default(20) }),
  z.object({ ...planBase, type: z.literal('notice'), tone: z.enum(['info', 'warning', 'error', 'success']).default('info'), title: z.string().trim().max(160).optional(), message: z.string().trim().min(1).max(2000), sourceIds: z.array(z.string()).max(6).default([]) }),
  z.object({ ...planBase, type: z.literal('recommendation'), tone: z.enum(['info', 'warning', 'error', 'success']).default('info'), title: z.string().trim().max(160).optional(), message: z.string().trim().min(1).max(2000), sourceIds: z.array(z.string()).max(6).default([]) }),
])

export const assistantCompositionPlanSchema = z.object({
  title: z.string().trim().min(1).max(220),
  summary: z.string().trim().min(1).max(2000),
  language: assistantLanguageSchema,
  sections: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(64),
    title: z.string().trim().max(200).optional(),
    layout: z.enum(['stack', 'grid', 'columns']).default('stack'),
    blocks: z.array(assistantPlanBlockSchema).min(1).max(12),
  })).min(1).max(12),
  suggestions: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
})

export type AssistantCompositionPlan = z.infer<typeof assistantCompositionPlanSchema>
export type AssistantDataSource = z.infer<typeof assistantDataSourceSchema>

export const assistantActionProposalSchema = z.object({
  id: z.string().trim().min(12).max(120),
  action: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1000),
  requiredPermission: permissionCodeSchema,
  payload: z.record(z.string(), z.unknown()),
  effect: z.string().trim().min(1).max(1000),
})

const assistantTextBlockSchema = z.object({
  type: z.literal('text'),
  content: z.string().trim().min(1).max(12000),
})

const assistantMetricsBlockSchema = z.object({
  type: z.literal('metrics'),
  title: z.string().trim().max(200).optional(),
  items: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    value: z.union([z.string().max(240), z.number()]),
    comparison: z.string().trim().max(240).optional(),
  })).min(1).max(12),
})

const assistantTableBlockSchema = z.object({
  type: z.literal('table'),
  title: z.string().trim().min(1).max(200),
  columns: z.array(z.object({
    key: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
  })).min(1).max(30),
  rows: z.array(z.record(z.string(), assistantScalarSchema)).max(200),
  total: z.number().int().min(0),
  truncated: z.boolean().optional().default(false),
  reportId: z.string().trim().max(64).optional(),
})

const assistantChartBlockSchema = z.object({
  type: z.literal('chart'),
  title: z.string().trim().min(1).max(200),
  chartType: z.enum(['line', 'bar', 'stacked_bar', 'area', 'pie', 'donut']),
  xKey: z.string().trim().min(1).max(80),
  series: z.array(z.object({
    key: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
  })).min(1).max(8),
  data: z.array(z.record(z.string(), assistantScalarSchema)).max(366),
})

const resolvedBlockBase = {
  id: z.string().trim().min(1).max(64),
  width: assistantWidthSchema,
  sourceIds: z.array(z.string().trim().min(1).max(64)).max(6).default([]),
}

const assistantCompositionBlockSchema = z.object({
  type: z.literal('composition'),
  title: z.string().trim().min(1).max(220),
  summary: z.string().trim().min(1).max(2000),
  language: assistantLanguageSchema,
  sections: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    title: z.string().trim().max(200).optional(),
    layout: z.enum(['stack', 'grid', 'columns']),
    blocks: z.array(z.discriminatedUnion('type', [
      z.object({ ...resolvedBlockBase, type: z.literal('narrative'), content: z.string().trim().min(1).max(4000) }),
      z.object({ ...resolvedBlockBase, type: z.literal('metrics'), title: z.string().trim().max(200).optional(), items: z.array(z.object({ label: z.string(), value: assistantScalarSchema, comparison: z.string().optional() })).min(1).max(12) }),
      z.object({ ...resolvedBlockBase, type: z.literal('comparison'), title: z.string(), label: z.string(), current: assistantScalarSchema, previous: assistantScalarSchema, change: assistantScalarSchema, mode: z.enum(['difference', 'percent_change']) }),
      z.object({ ...resolvedBlockBase, type: z.literal('table'), title: z.string(), columns: z.array(z.object({ key: z.string(), label: z.string() })).min(1).max(30), rows: z.array(z.record(z.string(), assistantScalarSchema)).max(10_000), total: z.number().int().min(0), truncated: z.boolean() }),
      z.object({ ...resolvedBlockBase, type: z.literal('chart'), title: z.string(), chartType: z.enum(['line', 'bar', 'stacked_bar', 'area', 'pie', 'donut']), xKey: z.string(), series: z.array(z.object({ key: z.string(), label: z.string() })).min(1).max(8), data: z.array(z.record(z.string(), assistantScalarSchema)).max(10_000) }),
      z.object({ ...resolvedBlockBase, type: z.literal('ranked_list'), title: z.string(), items: z.array(z.object({ label: z.string(), value: assistantScalarSchema, rank: z.number().int().positive() })).max(50) }),
      z.object({ ...resolvedBlockBase, type: z.literal('status_summary'), title: z.string(), items: z.array(z.object({ label: z.string(), value: assistantScalarSchema })).max(100) }),
      z.object({ ...resolvedBlockBase, type: z.literal('timeline'), title: z.string(), items: z.array(z.object({ date: z.string(), title: z.string(), detail: z.string().optional() })).max(100) }),
      z.object({ ...resolvedBlockBase, type: z.literal('notice'), tone: z.enum(['info', 'warning', 'error', 'success']), title: z.string().optional(), message: z.string() }),
      z.object({ ...resolvedBlockBase, type: z.literal('recommendation'), tone: z.enum(['info', 'warning', 'error', 'success']), title: z.string().optional(), message: z.string() }),
    ])).min(1).max(12),
  })).min(1).max(12),
  sources: z.array(z.object({ sourceId: z.string(), tool: z.string(), status: z.enum(['ok', 'error']) })).max(6),
})

const assistantReportBlockSchema = z.object({
  type: z.literal('report'),
  reportId: z.string().trim().min(1).max(64),
  reportType: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(220),
  generatedAt: z.string().datetime(),
  summary: z.string().trim().max(2000),
  filters: z.record(z.string(), z.unknown()),
  formats: z.array(z.enum(['pdf', 'csv'])).min(1).max(2),
  csvSections: z.array(z.object({ id: z.string().trim().min(1).max(64), label: z.string().trim().min(1).max(200) })).max(24).optional(),
})

const assistantFormBlockSchema = z.object({
  type: z.literal('form'),
  draftId: z.string().trim().min(1).max(64),
  workflow: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  fields: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    inputType: z.enum(['text', 'number', 'date', 'datetime-local', 'select', 'checkbox']),
    required: z.boolean(),
    value: z.unknown().optional(),
    options: z.array(z.object({ value: z.string(), label: z.string() })).max(100).optional(),
    error: z.string().trim().max(500).optional(),
  })).min(1).max(30),
  missingFields: z.array(z.string().trim().min(1).max(80)).max(30),
})

const assistantActionBlockSchema = z.object({
  type: z.literal('action_proposal'),
  proposal: assistantActionProposalSchema,
  expiresAt: z.string().datetime(),
})

const assistantNoticeBlockSchema = z.object({
  type: z.literal('notice'),
  tone: z.enum(['info', 'warning', 'error', 'success']),
  title: z.string().trim().max(160).optional(),
  message: z.string().trim().min(1).max(2000),
})

export const assistantBlockSchema = z.discriminatedUnion('type', [
  assistantTextBlockSchema,
  assistantMetricsBlockSchema,
  assistantTableBlockSchema,
  assistantChartBlockSchema,
  assistantReportBlockSchema,
  assistantFormBlockSchema,
  assistantActionBlockSchema,
  assistantNoticeBlockSchema,
  assistantCompositionBlockSchema,
])

export type AssistantBlock = z.infer<typeof assistantBlockSchema>

export const assistantStructuredMessageSchema = z.object({
  id: z.string().trim().min(1).max(64),
  conversationId: z.string().trim().min(1).max(64),
  role: z.enum(['USER', 'ASSISTANT']),
  language: assistantLanguageSchema,
  blocks: z.array(assistantBlockSchema).min(1).max(20),
  suggestions: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
  createdAt: z.string().datetime(),
})

export const assistantConversationParamSchema = z.object({
  id: z.string().trim().min(8).max(64),
})

export const createAssistantConversationBodySchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  preferredLanguage: assistantLanguageSchema.optional().default('en'),
}).strict()

export const updateAssistantConversationBodySchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  preferredLanguage: assistantLanguageSchema.optional(),
}).strict().refine((value) => value.title !== undefined || value.preferredLanguage !== undefined, {
  message: 'At least one conversation field is required',
})

export const assistantConversationMessageBodySchema = assistantMessageBodySchema.extend({
  language: assistantLanguageSchema.optional(),
}).strict()

export const assistantDraftParamSchema = z.object({
  id: z.string().trim().min(8).max(64),
})

export const updateAssistantDraftBodySchema = z.object({
  values: z.record(z.string(), z.unknown()),
}).strict()

export const assistantReportParamSchema = z.object({
  id: z.string().trim().min(8).max(64),
})

export const assistantReportExportQuerySchema = z.object({
  format: z.enum(['pdf', 'csv']),
  section: z.string().trim().min(1).max(64).optional(),
})

export const assistantResultSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('answer'),
    message: z.string().trim().min(1).max(4000),
    unavailableCode: z.string().trim().min(1).max(80).optional(),
    unavailableStage: z.enum(['tools', 'provider', 'planning', 'data', 'composition']).optional(),
    retryable: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('navigation'),
    message: z.string().trim().min(1).max(1000),
    path: z.string().trim().min(1).max(300),
    requiredPermission: permissionCodeSchema.optional(),
  }),
  z.object({
    type: z.literal('permission_denied'),
    message: z.string().trim().min(1).max(1000),
    requiredPermission: permissionCodeSchema,
  }),
  z.object({
    type: z.literal('action_proposal'),
    message: z.string().trim().min(1).max(1000),
    proposal: assistantActionProposalSchema,
  }),
  z.object({
    type: z.literal('composed_answer'),
    message: z.string().trim().min(1).max(4000),
    sources: z.array(assistantDataSourceSchema).min(1).max(6),
    composition: assistantCompositionPlanSchema,
  }),
])

export type AssistantResultBody = z.infer<typeof assistantResultSchema>

export const assistantChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  context: contextSchema,
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000) })).max(10).optional().default([]),
  permissions: z.array(permissionCodeSchema).max(100),
  toolSessionToken: z.string().trim().min(24).max(160),
  toolsUrl: z.string().url(),
})

export type AssistantChatRequest = z.infer<typeof assistantChatRequestSchema>

export const assistantToolListResponseSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(1000),
      requiredPermission: permissionCodeSchema.optional(),
      mutates: z.boolean(),
      inputSchema: z.record(z.string(), z.unknown()),
    }),
  ),
})

export const assistantToolCallBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  arguments: z.record(z.string(), z.unknown()).optional().default({}),
})

export type AssistantToolCallBody = z.infer<typeof assistantToolCallBodySchema>
