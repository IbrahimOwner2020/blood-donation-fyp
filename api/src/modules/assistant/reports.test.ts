import { describe, expect, test } from 'bun:test'

import {
  detectAssistantLanguage,
  renderAssistantReportCsv,
  renderAssistantReportPdf,
  type AssistantReportSnapshot,
} from './reports'
import { redactAssistantText, sanitizeAssistantBlock } from './persistence'
import type { AssistantCompositionSnapshot } from './composition'

const snapshot: AssistantReportSnapshot = {
  version: 1,
  reportType: 'inventory',
  title: 'Blood Inventory Report',
  generatedAt: '2026-09-28T10:00:00.000Z',
  filters: { bloodGroup: 'O+' },
  summary: 'Inventory summary.',
  metrics: [{ label: 'Available units', value: 12 }],
  tables: [{
    title: 'Inventory',
    columns: [{ key: 'group', label: 'Blood group' }, { key: 'value', label: 'Value' }],
    rows: [{ group: 'O+', value: '=2+3' }],
    total: 1,
  }],
  charts: [],
  warnings: [],
  sourcePeriod: { from: null, to: null },
}

const dynamicSnapshot: AssistantCompositionSnapshot = {
  version: 2,
  reportType: 'dynamic',
  title: 'Dynamic supply report',
  generatedAt: '2026-09-28T10:00:00.000Z',
  language: 'en',
  summary: 'Composed from authorized sources.',
  prompt: 'Generate a supply report',
  filters: {},
  queryPlan: [{ sourceId: 'source_inventory', tool: 'reports.inventory', arguments: {} }],
  requiredPermissions: ['reports:read'],
  compositionPlan: {
    title: 'Dynamic supply report',
    summary: 'Composed from authorized sources.',
    language: 'en',
    suggestions: [],
    sections: [{ id: 'overview', layout: 'stack', blocks: [{ id: 'inventory', type: 'table', width: 'full', title: 'Inventory', sourceId: 'source_inventory', path: 'groups', columns: [{ key: 'group', label: 'Blood group' }, { key: 'value', label: 'Value' }], limit: 200 }] }],
  },
  composition: {
    type: 'composition',
    title: 'Dynamic supply report',
    summary: 'Composed from authorized sources.',
    language: 'en',
    sources: [{ sourceId: 'source_inventory', tool: 'reports.inventory', status: 'ok' }],
    sections: [{ id: 'overview', layout: 'stack', blocks: [{ id: 'inventory', type: 'table', width: 'full', sourceIds: ['source_inventory'], title: 'Inventory', columns: [{ key: 'group', label: 'Blood group' }, { key: 'value', label: 'Value' }], rows: [{ group: 'O+', value: '=2+3' }], total: 1, truncated: false }] }],
  },
}

describe('assistant reports', () => {
  test('detects Swahili prompts', () => {
    expect(detectAssistantLanguage('Tengeneza ripoti ya damu')).toBe('sw')
  })

  test('renders a valid PDF envelope', () => {
    const pdf = renderAssistantReportPdf(snapshot)
    const text = new TextDecoder().decode(pdf)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.endsWith('%%EOF')).toBe(true)
    expect(text).toContain('Blood Inventory Report')
  })

  test('escapes CSV formulas and emits UTF-8 BOM', () => {
    const csv = renderAssistantReportCsv(snapshot)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"\'=2+3"')
  })

  test('renders version-2 compositions and exports a selected table safely', () => {
    const pdf = new TextDecoder().decode(renderAssistantReportPdf(dynamicSnapshot))
    const csv = renderAssistantReportCsv(dynamicSnapshot, 'inventory')
    expect(pdf).toContain('Dynamic supply report')
    expect(csv).toContain('"Inventory"')
    expect(csv).toContain('"\'=2+3"')
    expect(() => renderAssistantReportCsv(dynamicSnapshot, 'missing')).toThrow('not available')
  })

  test('redacts email and Tanzanian phone numbers from stored chat text', () => {
    expect(redactAssistantText('Contact jane@example.com or +255 712 345 678')).toBe(
      'Contact [email redacted] or [phone redacted]',
    )
  })

  test('keeps sensitive draft values and action payloads out of message history', () => {
    const form = sanitizeAssistantBlock({
      type: 'form',
      draftId: 'draft_123',
      workflow: 'donor.create',
      title: 'Donor',
      fields: [
        { name: 'phoneNumber', label: 'Phone', inputType: 'text', required: true, value: '+255712345678' },
        { name: 'bloodGroupId', label: 'Blood group', inputType: 'number', required: true, value: 1 },
      ],
      missingFields: [],
    })
    expect(form.type === 'form' && form.fields[0]?.value).toBeUndefined()
    expect(form.type === 'form' && form.fields[1]?.value).toBe(1)

    const action = sanitizeAssistantBlock({
      type: 'action_proposal',
      expiresAt: '2026-09-28T10:15:00.000Z',
      proposal: {
        id: 'action_123456',
        action: 'donor.create',
        title: 'Register donor',
        description: 'Create donor',
        requiredPermission: 'donors:create',
        payload: { email: 'jane@example.com' },
        effect: 'Creates a donor',
      },
    })
    expect(action.type === 'action_proposal' && action.proposal.payload).toEqual({})

    const composition = sanitizeAssistantBlock({
      ...dynamicSnapshot.composition,
      summary: 'Email jane@example.com',
      sections: [{ id: 'safe', layout: 'stack', blocks: [{ id: 'note', type: 'narrative', width: 'full', sourceIds: [], content: 'Call +255712345678' }] }],
    })
    expect(composition.type === 'composition' && composition.summary).toContain('[email redacted]')
    expect(composition.type === 'composition' && composition.sections[0]?.blocks[0]?.type === 'narrative' && composition.sections[0].blocks[0].content).toContain('[phone redacted]')
  })
})
