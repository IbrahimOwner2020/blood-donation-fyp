import { AppError } from '../../lib/errors'
import type { Db } from '../../db/client'
import {
  assistantBlockSchema,
  assistantCompositionPlanSchema,
  type AssistantBlock,
  type AssistantCompositionPlan,
  type AssistantDataSource,
} from './schemas'
import { callAssistantTool, listAssistantTools, sanitizeAssistantToolResult } from './tools'
import type { AssistantToolSession } from './tool-session-store'

type Scalar = string | number | boolean | null
type ResolvedComposition = Extract<AssistantBlock, { type: 'composition' }>
type ResolvedCompositionSection = ResolvedComposition['sections'][number]
type ResolvedCompositionBlock = ResolvedCompositionSection['blocks'][number]
type SourceExecution = {
  source: AssistantDataSource
  status: 'ok' | 'error'
  result?: unknown
  error?: string
  requiredPermission?: string
}

export type AssistantCompositionSnapshot = {
  version: 2
  reportType: 'dynamic'
  title: string
  generatedAt: string
  language: 'en' | 'sw'
  summary: string
  prompt: string
  filters: Record<string, unknown>
  queryPlan: AssistantDataSource[]
  requiredPermissions: string[]
  compositionPlan: AssistantCompositionPlan
  composition: Extract<AssistantBlock, { type: 'composition' }>
}

const forbiddenPathSegment = /^(?:__proto__|prototype|constructor)$/i
const sensitiveField = /(?:phone|email|password|secret|token|hash|contact)/i

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function pathSegments(path: string): string[] {
  if (!path) return []
  const parts = path.split('.').filter(Boolean)
  if (parts.some((part) => forbiddenPathSegment.test(part) || sensitiveField.test(part))) {
    throw AppError.badRequest('Assistant layout references a restricted data field')
  }
  return parts
}

function atPath(value: unknown, path: string): unknown {
  let current = value
  for (const part of pathSegments(path)) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)]
      continue
    }
    const currentRecord = record(current)
    if (!currentRecord || !(part in currentRecord)) {
      throw AppError.badRequest(`Assistant layout references unavailable path "${path}"`)
    }
    current = currentRecord[part]
  }
  return current
}

function scalar(value: unknown): Scalar {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  const nested = record(value)
  if (nested) {
    for (const key of ['code', 'name', 'label', 'id']) {
      if (key in nested) return scalar(nested[key])
    }
  }
  throw AppError.badRequest('Assistant layout expected a scalar value')
}

function numeric(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw AppError.badRequest('Assistant layout expected a numeric value')
  return parsed
}

function collection(source: unknown, path: string): unknown[] {
  const value = atPath(source, path)
  if (!Array.isArray(value)) throw AppError.badRequest(`Assistant layout path "${path}" is not a collection`)
  return value
}

function resolveBinding(binding: {
  sourceId: string
  path: string
  operation: 'value' | 'count' | 'sum' | 'average' | 'minimum' | 'maximum'
  field?: string
}, sources: Map<string, SourceExecution>): Scalar {
  const execution = sources.get(binding.sourceId)
  if (!execution || execution.status !== 'ok') throw AppError.badRequest(`Assistant source "${binding.sourceId}" is unavailable`)
  const value = atPath(execution.result, binding.path)
  if (binding.operation === 'value') return scalar(value)
  if (binding.operation === 'count') return Array.isArray(value) ? value.length : numeric(value)
  if (!Array.isArray(value)) throw AppError.badRequest(`Assistant operation ${binding.operation} requires a collection`)
  const numbers = value.map((item) => numeric(binding.field ? atPath(item, binding.field) : item))
  if (!numbers.length) return 0
  if (binding.operation === 'sum') return numbers.reduce((total, item) => total + item, 0)
  if (binding.operation === 'average') return numbers.reduce((total, item) => total + item, 0) / numbers.length
  if (binding.operation === 'minimum') return Math.min(...numbers)
  return Math.max(...numbers)
}

function rowFrom(item: unknown, keys: string[]): Record<string, Scalar> {
  return Object.fromEntries(keys.map((key) => [key, scalar(atPath(item, key))]))
}

export async function executeCompositionSources(
  db: Db,
  session: AssistantToolSession,
  rawSources: AssistantDataSource[],
): Promise<SourceExecution[]> {
  const sources = rawSources.map((source) => assistantDataSource(source))
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    throw AppError.badRequest('Assistant source identifiers must be unique')
  }
  const available = new Map(listAssistantTools(session).map((tool) => [tool.name, tool]))
  const output: SourceExecution[] = []
  for (const source of sources) {
    const descriptor = available.get(source.tool)
    if (!descriptor || descriptor.mutates) {
      throw AppError.badRequest(`Assistant composition cannot use tool "${source.tool}"`)
    }
    try {
      output.push({
        source,
        status: 'ok',
        result: sanitizeAssistantToolResult(await callAssistantTool(db, session, source.tool, source.arguments)),
        requiredPermission: descriptor.requiredPermission,
      })
    } catch (error) {
      output.push({
        source,
        status: 'error',
        error: error instanceof Error ? error.message : 'Data source unavailable',
        requiredPermission: descriptor.requiredPermission,
      })
    }
  }
  if (!output.some((item) => item.status === 'ok')) {
    throw AppError.badRequest('No assistant data sources could be loaded')
  }
  return output
}

function assistantDataSource(source: AssistantDataSource): AssistantDataSource {
  return {
    sourceId: source.sourceId,
    tool: source.tool,
    arguments: source.arguments ?? {},
  }
}

export function resolveAssistantComposition(
  rawPlan: AssistantCompositionPlan,
  executions: SourceExecution[],
): ResolvedComposition {
  const plan = assistantCompositionPlanSchema.parse(rawPlan)
  const sourceMap = new Map(executions.map((execution) => [execution.source.sourceId, execution]))
  const failedIds = new Set(executions.filter((item) => item.status === 'error').map((item) => item.source.sourceId))

  const sections: ResolvedCompositionSection[] = []
  for (const section of plan.sections) {
    const blocks: ResolvedCompositionBlock[] = []
    for (const block of section.blocks) {
      const referenced = 'sourceId' in block
        ? [block.sourceId]
        : 'sourceIds' in block
          ? block.sourceIds
          : block.type === 'metrics'
            ? block.items.map((item) => item.binding.sourceId)
            : block.type === 'comparison'
              ? [block.current.sourceId, block.previous.sourceId]
              : []
      if (referenced.some((sourceId) => failedIds.has(sourceId))) continue
      const base = { id: block.id, width: block.width, sourceIds: [...new Set(referenced)] }

      if (block.type === 'narrative') {
        blocks.push({ ...base, type: 'narrative', content: block.content })
        continue
      }
      if (block.type === 'notice' || block.type === 'recommendation') {
        blocks.push({ ...base, type: block.type, tone: block.tone, title: block.title, message: block.message })
        continue
      }
      if (block.type === 'metrics') {
        blocks.push({ ...base, type: 'metrics', title: block.title, items: block.items.map((item) => ({ label: item.label, value: resolveBinding(item.binding, sourceMap), ...(item.comparison ? { comparison: item.comparison } : {}) })) })
        continue
      }
      if (block.type === 'comparison') {
        const current = numeric(resolveBinding(block.current, sourceMap))
        const previous = numeric(resolveBinding(block.previous, sourceMap))
        const change = block.mode === 'percent_change' ? (previous === 0 ? 0 : ((current - previous) / previous) * 100) : current - previous
        blocks.push({ ...base, type: 'comparison', title: block.title, label: block.label, current, previous, change, mode: block.mode })
        continue
      }
      const execution = sourceMap.get(block.sourceId)
      if (!execution || execution.status !== 'ok') continue
      let items = collection(execution.result, block.path)
      if (block.type === 'table') {
        if (block.sort) {
          items = [...items].sort((a, b) => String(atPath(a, block.sort!.key)).localeCompare(String(atPath(b, block.sort!.key)), undefined, { numeric: true }) * (block.sort!.direction === 'desc' ? -1 : 1))
        }
        const rows = items.slice(0, block.limit).map((item) => rowFrom(item, block.columns.map((column) => column.key)))
        blocks.push({ ...base, type: 'table', title: block.title, columns: block.columns.map(({ key, label }) => ({ key, label })), rows, total: items.length, truncated: items.length > rows.length })
        continue
      }
      if (block.type === 'chart') {
        blocks.push({ ...base, type: 'chart', title: block.title, chartType: block.chartType, xKey: block.xKey, series: block.series, data: items.slice(0, 10_000).map((item) => rowFrom(item, [block.xKey, ...block.series.map((series) => series.key)])) })
        continue
      }
      if (block.type === 'ranked_list') {
        const direction = block.direction === 'desc' ? -1 : 1
        const ranked = [...items].sort((a, b) => (numeric(atPath(a, block.valueKey)) - numeric(atPath(b, block.valueKey))) * direction).slice(0, block.limit)
        blocks.push({ ...base, type: 'ranked_list', title: block.title, items: ranked.map((item, index) => ({ rank: index + 1, label: String(scalar(atPath(item, block.labelKey)) ?? ''), value: scalar(atPath(item, block.valueKey)) })) })
        continue
      }
      if (block.type === 'status_summary') {
        blocks.push({ ...base, type: 'status_summary', title: block.title, items: items.slice(0, 100).map((item) => ({ label: String(scalar(atPath(item, block.labelKey)) ?? ''), value: scalar(atPath(item, block.valueKey)) })) })
        continue
      }
      blocks.push({ ...base, type: 'timeline', title: block.title, items: items.slice(0, block.limit).map((item) => ({ date: String(scalar(atPath(item, block.dateKey)) ?? ''), title: String(scalar(atPath(item, block.titleKey)) ?? ''), ...(block.detailKey ? { detail: String(scalar(atPath(item, block.detailKey)) ?? '') } : {}) })) })
    }
    if (blocks.length) sections.push({ id: section.id, title: section.title, layout: section.layout, blocks })
  }

  if (executions.some((item) => item.status === 'error')) {
    sections.push({
      id: 'partial-data',
      title: plan.language === 'sw' ? 'Upatikanaji wa data' : 'Data availability',
      layout: 'stack',
      blocks: [{
        id: 'partial-data-warning',
        type: 'notice',
        width: 'full',
        sourceIds: executions.filter((item) => item.status === 'error').map((item) => item.source.sourceId),
        tone: 'warning',
        message: plan.language === 'sw' ? 'Baadhi ya vyanzo vya data havikupatikana.' : 'Some requested data sources were unavailable.',
      }],
    })
  }
  if (!sections.length) throw AppError.badRequest('Assistant composition did not contain any renderable sections')

  return assistantBlockSchema.parse({
    type: 'composition',
    title: plan.title,
    summary: plan.summary,
    language: plan.language,
    sections,
    sources: executions.map((item) => ({ sourceId: item.source.sourceId, tool: item.source.tool, status: item.status })),
  }) as ResolvedComposition
}

export function previewAssistantComposition(
  composition: ResolvedComposition,
): ResolvedComposition {
  return {
    ...composition,
    sections: composition.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => block.type === 'table'
        ? { ...block, rows: block.rows.slice(0, 200), truncated: block.total > 200 || block.truncated }
        : block.type === 'chart'
          ? { ...block, data: block.data.slice(0, 366) }
          : block),
    })),
  }
}

export function compositionRequiredPermissions(executions: SourceExecution[]): string[] {
  return [...new Set(executions.flatMap((item) => item.requiredPermission ? [item.requiredPermission] : []))]
}
