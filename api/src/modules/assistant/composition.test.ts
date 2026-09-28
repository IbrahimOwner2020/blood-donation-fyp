import { describe, expect, test } from 'bun:test'

import { previewAssistantComposition, resolveAssistantComposition } from './composition'
import type { AssistantCompositionPlan } from './schemas'

const plan: AssistantCompositionPlan = {
  title: 'Supply comparison',
  summary: 'Authorized operational data.',
  language: 'en',
  suggestions: ['Show shortages'],
  sections: [{
    id: 'overview',
    layout: 'grid',
    blocks: [
      {
        id: 'metrics',
        type: 'metrics',
        width: 'half',
        items: [
          { label: 'Available', binding: { sourceId: 'source_inventory', path: 'totals.availableUnits', operation: 'value' } },
          { label: 'Requested', binding: { sourceId: 'source_requests', path: 'byBloodGroup', operation: 'sum', field: 'unitsRequested' } },
        ],
      },
      {
        id: 'groups',
        type: 'table',
        width: 'half',
        title: 'Inventory by group',
        sourceId: 'source_inventory',
        path: 'groups',
        columns: [{ key: 'bloodGroup', label: 'Blood group' }, { key: 'availableUnits', label: 'Available' }],
        limit: 200,
      },
      {
        id: 'trend',
        type: 'chart',
        width: 'full',
        title: 'Request trend',
        chartType: 'line',
        sourceId: 'source_requests',
        path: 'byDate',
        xKey: 'date',
        series: [{ key: 'unitsRequested', label: 'Requested' }],
      },
    ],
  }],
}

const executions = [
  {
    source: { sourceId: 'source_inventory', tool: 'reports.inventory', arguments: {} },
    status: 'ok' as const,
    requiredPermission: 'reports:read',
    result: { totals: { availableUnits: 18 }, groups: [{ bloodGroup: 'O+', availableUnits: 12 }, { bloodGroup: 'A+', availableUnits: 6 }] },
  },
  {
    source: { sourceId: 'source_requests', tool: 'reports.blood_requests', arguments: {} },
    status: 'ok' as const,
    requiredPermission: 'reports:read',
    result: { byBloodGroup: [{ unitsRequested: 11 }, { unitsRequested: 7 }], byDate: [{ date: '2026-09-28', unitsRequested: 4 }] },
  },
]

describe('assistant composition resolver', () => {
  test('resolves all numeric and tabular values from authoritative source results', () => {
    const composition = resolveAssistantComposition(plan, executions)
    const blocks = composition.sections[0]?.blocks ?? []
    const metrics = blocks.find((block) => block.type === 'metrics')
    const table = blocks.find((block) => block.type === 'table')

    expect(metrics?.type).toBe('metrics')
    if (metrics?.type === 'metrics') expect(metrics.items.map((item) => item.value)).toEqual([18, 18])
    expect(table?.type).toBe('table')
    if (table?.type === 'table') expect(table.rows[0]).toEqual({ bloodGroup: 'O+', availableUnits: 12 })
  })

  test('rejects sensitive or invented source paths', () => {
    const unsafe = structuredClone(plan)
    const metrics = unsafe.sections[0]?.blocks[0]
    if (metrics?.type === 'metrics') metrics.items[0]!.binding.path = 'donor.email'
    expect(() => resolveAssistantComposition(unsafe, executions)).toThrow('restricted data field')

    if (metrics?.type === 'metrics') metrics.items[0]!.binding.path = 'totals.inventedValue'
    expect(() => resolveAssistantComposition(unsafe, executions)).toThrow('unavailable path')
  })

  test('keeps successful sections and adds a warning for a failed source', () => {
    const partialPlan = structuredClone(plan)
    partialPlan.sections[0]!.blocks = partialPlan.sections[0]!.blocks.filter((block) => block.id !== 'trend')
    const partial = resolveAssistantComposition(partialPlan, [executions[0]!, { ...executions[1]!, status: 'error' as const, result: undefined, error: 'unavailable' }])
    expect(partial.sections.some((section) => section.id === 'partial-data')).toBe(true)
    expect(partial.sections[0]?.blocks.some((block) => block.type === 'table')).toBe(true)
  })

  test('limits conversation previews while retaining report totals', () => {
    const many = resolveAssistantComposition(plan, [{ ...executions[0]!, result: { totals: { availableUnits: 250 }, groups: Array.from({ length: 250 }, (_, index) => ({ bloodGroup: `G${index}`, availableUnits: index })) } }, executions[1]!])
    const preview = previewAssistantComposition(many)
    const table = preview.sections[0]?.blocks.find((block) => block.type === 'table')
    if (table?.type === 'table') {
      expect(table.rows).toHaveLength(200)
      expect(table.total).toBe(250)
      expect(table.truncated).toBe(true)
    }
  })
})
