import type { Db } from '../../db/client'
import { AppError } from '../../lib/errors'
import { requireHospitalFacilityId } from '../auth/access-scope'
import type { AuthUser } from '../../lib/types'
import { listAiAnalysisRuns } from '../ai-analysis/service'
import { listAiAnalysisQuerySchema } from '../ai-analysis/schemas'
import { listAlerts } from '../alerts/service'
import { listAlertsQuerySchema } from '../alerts/schemas'
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
import type { AssistantBlock } from './schemas'
import type { AssistantCompositionSnapshot } from './composition'

export type AssistantReportType =
  | 'supply'
  | 'inventory'
  | 'donations'
  | 'blood_requests'
  | 'donor_eligibility'
  | 'notifications'
  | 'shortages'
  | 'ai_analysis'

export type AssistantReportSnapshot = {
  version: 1
  reportType: AssistantReportType
  title: string
  generatedAt: string
  filters: Record<string, unknown>
  summary: string
  metrics: Array<{ label: string; value: string | number; comparison?: string }>
  tables: Array<{
    title: string
    columns: Array<{ key: string; label: string }>
    rows: Array<Record<string, string | number | boolean | null>>
    total: number
    truncated?: boolean
  }>
  charts: Array<{
    title: string
    chartType: 'line' | 'bar' | 'pie'
    xKey: string
    series: Array<{ key: string; label: string }>
    data: Array<Record<string, string | number | boolean | null>>
  }>
  warnings: string[]
  sourcePeriod: { from: string | null; to: string | null; asOf?: string }
}

const TITLES: Record<AssistantReportType, { en: string; sw: string }> = {
  supply: { en: 'Blood Supply Report', sw: 'Ripoti ya Upatikanaji wa Damu' },
  inventory: { en: 'Blood Inventory Report', sw: 'Ripoti ya Akiba ya Damu' },
  donations: { en: 'Blood Donations Report', sw: 'Ripoti ya Michango ya Damu' },
  blood_requests: { en: 'Blood Requests Report', sw: 'Ripoti ya Maombi ya Damu' },
  donor_eligibility: { en: 'Donor Eligibility Report', sw: 'Ripoti ya Hali ya Wafadhili' },
  notifications: { en: 'Donor Notification Report', sw: 'Ripoti ya Taarifa kwa Wafadhili' },
  shortages: { en: 'Predicted Shortage Report', sw: 'Ripoti ya Upungufu Uliotabiriwa' },
  ai_analysis: { en: 'AI Analysis Report', sw: 'Ripoti ya Uchambuzi wa AI' },
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function scalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 5).map(String).join(', ')
  const nested = record(value)
  return String(nested.code ?? nested.name ?? nested.label ?? nested.id ?? '')
}

function rowsOf(items: unknown[], keys: string[]) {
  return items.slice(0, 10_000).map((item) => {
    const source = record(item)
    return Object.fromEntries(keys.map((key) => [key, scalar(source[key])]))
  })
}

function label(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ').trim().replace(/^./, (c) => c.toUpperCase())
}

function table(title: string, items: unknown[], keys: string[]) {
  return {
    title,
    columns: keys.map((key) => ({ key, label: label(key) })),
    rows: rowsOf(items, keys),
    total: items.length,
    truncated: items.length > 10_000,
  }
}

function parseFilters(message: string): Record<string, unknown> {
  const bloodGroup = message.toUpperCase().match(/(^|[^A-Z0-9])((?:AB|A|B|O)[+-])(?=$|[^A-Z0-9])/)?.[2]
  const dates = Array.from(message.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)).map((match) => match[1])
  const horizon = Number(message.match(/\b(7|14|30|60)\s*(?:day|days|siku)?\b/i)?.[1] ?? 0)
  return {
    ...(bloodGroup ? { bloodGroup } : {}),
    ...(dates[0] ? { from: dates[0] } : {}),
    ...(dates[1] ? { to: dates[1] } : {}),
    ...(horizon ? { horizonDays: horizon } : {}),
  }
}

export function detectAssistantLanguage(message: string, preferred?: 'en' | 'sw'): 'en' | 'sw' {
  if (preferred) return preferred
  const swahiliWords = /\b(ripoti|damu|wafadhili|upungufu|onyesha|tengeneza|hali|leo|siku|tafadhali|maombi|michango)\b/i
  return swahiliWords.test(message) ? 'sw' : 'en'
}

export function reportTitle(type: AssistantReportType, language: 'en' | 'sw') {
  return TITLES[type][language]
}

export async function buildAssistantReport(
  db: Db,
  input: {
    reportType: AssistantReportType
    message?: string
    filters?: Record<string, unknown>
    language: 'en' | 'sw'
    user: AuthUser | undefined
    roles: string[]
  },
): Promise<AssistantReportSnapshot> {
  const filters = input.filters ?? parseFilters(input.message ?? '')
  const facilityId = input.user ? requireHospitalFacilityId(input.user, input.roles) : null
  const facilityScoped = typeof facilityId === 'number'
  const scopedFilters = typeof facilityId === 'number' ? { ...filters, facilityId } : filters
  const title = reportTitle(input.reportType, input.language)
  const snapshot: AssistantReportSnapshot = {
    version: 1,
    reportType: input.reportType,
    title,
    generatedAt: new Date().toISOString(),
    filters: scopedFilters,
    summary: input.language === 'sw'
      ? 'Ripoti hii imetengenezwa kutoka kwenye taarifa za mfumo zilizoidhinishwa.'
      : 'This report was generated from authorized live system data.',
    metrics: [],
    tables: [],
    charts: [],
    warnings: [],
    sourcePeriod: {
      from: typeof filters.from === 'string' ? filters.from : null,
      to: typeof filters.to === 'string' ? filters.to : null,
    },
  }

  if (input.reportType === 'inventory' || input.reportType === 'supply') {
    const inventory = await getInventoryReport(db, inventoryReportQuerySchema.parse(scopedFilters))
    snapshot.sourcePeriod.asOf = inventory.asOf
    snapshot.metrics.push(
      { label: input.language === 'sw' ? 'Vipimo vilivyopo' : 'Available units', value: inventory.totals.availableUnits },
      { label: input.language === 'sw' ? 'Vilivyohifadhiwa' : 'Reserved units', value: inventory.totals.reservedUnits },
      { label: input.language === 'sw' ? 'Vinavyokaribia kuisha' : 'Expiring soon', value: inventory.totals.expiringSoonUnits },
      { label: input.language === 'sw' ? 'Makundi yenye akiba ndogo' : 'Low-stock groups', value: inventory.totals.lowStockGroupCount },
    )
    snapshot.tables.push(table(
      input.language === 'sw' ? 'Akiba kwa kundi la damu' : 'Inventory by blood group',
      inventory.groups,
      ['bloodGroup', 'availableUnits', 'reservedUnits', 'expiringSoonUnits', 'lowStock'],
    ))
    snapshot.charts.push({
      title: input.language === 'sw' ? 'Vipimo vilivyopo kwa kundi' : 'Available units by blood group',
      chartType: 'bar',
      xKey: 'bloodGroup',
      series: [{ key: 'availableUnits', label: input.language === 'sw' ? 'Vilivyopo' : 'Available' }],
      data: rowsOf(inventory.groups, ['bloodGroup', 'availableUnits']),
    })
  }

  if ((input.reportType === 'donations' || input.reportType === 'supply') && !facilityScoped) {
    const donations = await getDonationsReport(db, donationsReportQuerySchema.parse(filters))
    snapshot.metrics.push(
      { label: input.language === 'sw' ? 'Michango' : 'Donations', value: donations.totals.donationCount },
      { label: input.language === 'sw' ? 'Vipimo vilivyokusanywa' : 'Units collected', value: donations.totals.units },
    )
    snapshot.tables.push(table(
      input.language === 'sw' ? 'Michango kwa kundi la damu' : 'Donations by blood group',
      donations.byBloodGroup,
      ['bloodGroup', 'donationCount', 'units'],
    ))
    snapshot.charts.push({
      title: input.language === 'sw' ? 'Mwenendo wa michango' : 'Donation trend',
      chartType: 'line',
      xKey: 'date',
      series: [{ key: 'units', label: input.language === 'sw' ? 'Vipimo' : 'Units' }],
      data: rowsOf(donations.byDate, ['date', 'units']),
    })
  }
  if (input.reportType === 'donations' && facilityScoped) {
    snapshot.warnings.push(input.language === 'sw' ? 'Ripoti ya michango haipatikani kwa upeo wa kituo hiki.' : 'Donation reporting is not available within this facility scope.')
  }

  if (input.reportType === 'blood_requests' || input.reportType === 'supply') {
    const requests = await getBloodRequestsReport(db, bloodRequestsReportQuerySchema.parse(scopedFilters))
    snapshot.metrics.push(
      { label: input.language === 'sw' ? 'Maombi ya damu' : 'Blood requests', value: requests.totals.requestCount },
      { label: input.language === 'sw' ? 'Vipimo vilivyoombwa' : 'Units requested', value: requests.totals.unitsRequested },
      { label: input.language === 'sw' ? 'Vipimo vilivyotolewa' : 'Units fulfilled', value: requests.totals.fulfilledUnits },
    )
    snapshot.tables.push(table(
      input.language === 'sw' ? 'Maombi kwa kundi la damu' : 'Requests by blood group',
      requests.byBloodGroup,
      ['bloodGroup', 'requestCount', 'unitsRequested', 'fulfilledUnits'],
    ))
    snapshot.charts.push({
      title: input.language === 'sw' ? 'Mwenendo wa mahitaji' : 'Demand trend',
      chartType: 'line',
      xKey: 'date',
      series: [{ key: 'unitsRequested', label: input.language === 'sw' ? 'Vilivyoombwa' : 'Requested units' }],
      data: rowsOf(requests.byDate, ['date', 'unitsRequested']),
    })
  }

  if (input.reportType === 'donor_eligibility' && !facilityScoped) {
    const donors = await getDonorEligibilityReport(db, donorEligibilityReportQuerySchema.parse(filters))
    snapshot.metrics.push(
      { label: input.language === 'sw' ? 'Wafadhili wote' : 'Total donors', value: donors.totals.total ?? 0 },
      { label: input.language === 'sw' ? 'Wanaoweza kuchangia' : 'Eligible donors', value: donors.totals.eligible ?? 0 },
    )
    snapshot.tables.push(table(
      input.language === 'sw' ? 'Hali za wafadhili' : 'Donor eligibility status',
      donors.donors,
      ['donorNumber', 'name', 'bloodGroup', 'donationCount', 'lastDonationDate', 'nextEligibleDate', 'status'],
    ))
  }
  if (input.reportType === 'donor_eligibility' && facilityScoped) snapshot.warnings.push(input.language === 'sw' ? 'Ripoti hii imezuiwa kwa upeo wa kituo.' : 'This report is restricted for facility-scoped accounts.')

  if (input.reportType === 'notifications' && !facilityScoped) {
    const notifications = await getNotificationsReport(db, notificationsReportQuerySchema.parse(filters))
    const statusCount = (status: string) => notifications.byStatus.find((item) => item.status === status)?.count ?? 0
    snapshot.metrics.push(
      { label: input.language === 'sw' ? 'Taarifa zote' : 'Total notifications', value: notifications.totals.total },
      { label: input.language === 'sw' ? 'Zilizotumwa' : 'Sent', value: statusCount('SENT') },
      { label: input.language === 'sw' ? 'Zilizoshindwa' : 'Failed', value: statusCount('FAILED') },
    )
    snapshot.tables.push(table(
      input.language === 'sw' ? 'Taarifa kwa njia' : 'Notifications by channel',
      notifications.byChannel,
      ['channel', 'count'],
    ))
  }
  if (input.reportType === 'notifications' && facilityScoped) snapshot.warnings.push(input.language === 'sw' ? 'Ripoti hii imezuiwa kwa upeo wa kituo.' : 'This report is restricted for facility-scoped accounts.')

  if (input.reportType === 'shortages' || input.reportType === 'supply') {
    const alerts = await listAlerts(db, listAlertsQuerySchema.parse({
      activeOnly: 'true',
      limit: 100,
      ...(filters.bloodGroup ? { bloodGroup: filters.bloodGroup } : {}),
      ...(typeof facilityId === 'number' ? { facilityId } : {}),
    }))
    snapshot.metrics.push({ label: input.language === 'sw' ? 'Tahadhari hai' : 'Active shortage alerts', value: alerts.total })
    snapshot.tables.push(table(
      input.language === 'sw' ? 'Upungufu uliotabiriwa' : 'Predicted shortages',
      alerts.items,
      ['bloodGroup', 'severity', 'status', 'availableUnits', 'predictedUnits', 'projectedGap'],
    ))
  }

  if ((input.reportType === 'ai_analysis' || input.reportType === 'supply') && !facilityScoped) {
    const analyses = await listAiAnalysisRuns(db, listAiAnalysisQuerySchema.parse({ limit: 50 }))
    snapshot.metrics.push({ label: input.language === 'sw' ? 'Uchambuzi wa AI' : 'AI analysis runs', value: analyses.total })
    snapshot.tables.push(table(
      input.language === 'sw' ? 'Uchambuzi wa hivi karibuni' : 'Recent AI analysis',
      analyses.items,
      ['id', 'status', 'horizonDays', 'riskLevel', 'notificationMode', 'createdAt'],
    ))
  }
  if (input.reportType === 'ai_analysis' && facilityScoped) snapshot.warnings.push(input.language === 'sw' ? 'Uchambuzi wa kitaifa haupatikani kwa akaunti ya kituo.' : 'National AI analysis is not available to facility-scoped accounts.')

  if (!snapshot.tables.length) {
    snapshot.warnings.push(input.language === 'sw' ? 'Hakuna taarifa zilizopatikana.' : 'No report data was available.')
  }
  return snapshot
}

export function reportSnapshotBlocks(snapshot: AssistantReportSnapshot, reportId: string): AssistantBlock[] {
  return [
    { type: 'text', content: snapshot.summary },
    ...(snapshot.metrics.length ? [{ type: 'metrics' as const, title: snapshot.title, items: snapshot.metrics }] : []),
    ...snapshot.tables.slice(0, 4).map((item) => ({
      type: 'table' as const,
      ...item,
      rows: item.rows.slice(0, 50),
      truncated: item.total > 50,
      reportId,
    })),
    ...snapshot.charts.slice(0, 3).map((item) => ({ type: 'chart' as const, ...item })),
    ...snapshot.warnings.map((message) => ({ type: 'notice' as const, tone: 'warning' as const, message })),
    {
      type: 'report',
      reportId,
      reportType: snapshot.reportType,
      title: snapshot.title,
      generatedAt: snapshot.generatedAt,
      summary: snapshot.summary,
      filters: snapshot.filters,
      formats: ['pdf', 'csv'],
    },
  ]
}

function cleanPdfText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
}

function wrapLine(value: string, width = 96): string[] {
  const words = cleanPdfText(value).split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > width && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

function pdfEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

export function renderAssistantReportPdf(snapshot: AssistantReportSnapshot | AssistantCompositionSnapshot): Uint8Array {
  if (snapshot.version === 2) return renderCompositionPdf(snapshot)
  const lines: string[] = [
    'NBTS | AI Operations Assistant',
    snapshot.title,
    `Generated: ${snapshot.generatedAt}`,
    `Filters: ${JSON.stringify(snapshot.filters)}`,
    '',
    snapshot.summary,
    '',
  ]
  for (const metric of snapshot.metrics) lines.push(`${metric.label}: ${metric.value}`)
  for (const section of snapshot.tables) {
    lines.push('', section.title)
    lines.push(section.columns.map((column) => column.label).join(' | '))
    for (const row of section.rows) {
      lines.push(section.columns.map((column) => String(row[column.key] ?? '')).join(' | '))
    }
  }
  for (const warning of snapshot.warnings) lines.push('', `Warning: ${warning}`)
  const wrapped = lines.flatMap((line) => wrapLine(line))
  const pageLines: string[][] = []
  for (let index = 0; index < wrapped.length; index += 48) pageLines.push(wrapped.slice(index, index + 48))
  if (!pageLines.length) pageLines.push(['No report data.'])

  const objects: string[] = []
  const pageObjectIds: number[] = []
  const contentObjectIds: number[] = []
  const fontId = 3
  let nextId = 4
  for (let i = 0; i < pageLines.length; i += 1) {
    pageObjectIds.push(nextId++)
    contentObjectIds.push(nextId++)
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  for (let i = 0; i < pageLines.length; i += 1) {
    const pageId = pageObjectIds[i]
    const contentId = contentObjectIds[i]
    const stream = [
      'BT',
      '/F1 10 Tf',
      '40 800 Td',
      '14 TL',
      ...pageLines[i].map((line) => `(${pdfEscape(line)}) Tj T*`),
      `(${pdfEscape(`Page ${i + 1} of ${pageLines.length}`)}) Tj`,
      'ET',
    ].join('\n')
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    objects[contentId] = `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`
  }
  let output = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = new TextEncoder().encode(output).length
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = new TextEncoder().encode(output).length
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(output)
}

function csvCell(value: unknown): string {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function renderAssistantReportCsv(snapshot: AssistantReportSnapshot | AssistantCompositionSnapshot, sectionId?: string): string {
  if (snapshot.version === 2) return renderCompositionCsv(snapshot, sectionId)
  const lines = [
    ['Report', snapshot.title],
    ['Generated', snapshot.generatedAt],
    ['Filters', JSON.stringify(snapshot.filters)],
  ].map((row) => row.map(csvCell).join(','))
  for (const section of snapshot.tables) {
    lines.push('', [section.title].map(csvCell).join(','))
    lines.push(section.columns.map((column) => csvCell(column.label)).join(','))
    for (const row of section.rows) {
      lines.push(section.columns.map((column) => csvCell(row[column.key])).join(','))
    }
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

function renderCompositionPdf(snapshot: AssistantCompositionSnapshot): Uint8Array {
  const lines: string[] = [
    'NBTS | AI Operations Assistant',
    snapshot.title,
    `Generated: ${snapshot.generatedAt}`,
    '',
    snapshot.summary,
  ]
  for (const section of snapshot.composition.sections) {
    if (section.title) lines.push('', section.title)
    for (const block of section.blocks) {
      if (block.type === 'narrative') lines.push('', block.content)
      if (block.type === 'metrics') for (const item of block.items) lines.push(`${item.label}: ${item.value ?? ''}`)
      if (block.type === 'comparison') lines.push(`${block.label}: ${block.current ?? ''} vs ${block.previous ?? ''} (${block.change ?? ''})`)
      if (block.type === 'table') {
        lines.push('', block.title, block.columns.map((column) => column.label).join(' | '))
        for (const row of block.rows) lines.push(block.columns.map((column) => String(row[column.key] ?? '')).join(' | '))
      }
      if (block.type === 'chart') {
        lines.push('', `${block.title} (${block.chartType})`)
        lines.push([block.xKey, ...block.series.map((series) => series.label)].join(' | '))
        for (const point of block.data.slice(0, 200)) {
          lines.push([point[block.xKey], ...block.series.map((series) => point[series.key])].map((value) => String(value ?? '')).join(' | '))
        }
      }
      if (block.type === 'ranked_list') for (const item of block.items) lines.push(`${item.rank}. ${item.label}: ${item.value ?? ''}`)
      if (block.type === 'status_summary') for (const item of block.items) lines.push(`${item.label}: ${item.value ?? ''}`)
      if (block.type === 'timeline') for (const item of block.items) lines.push(`${item.date}: ${item.title}${item.detail ? ` - ${item.detail}` : ''}`)
      if (block.type === 'notice' || block.type === 'recommendation') lines.push('', `${block.title ?? block.type}: ${block.message}`)
    }
  }
  const wrapped = lines.flatMap((line) => wrapLine(line))
  const v1: AssistantReportSnapshot = {
    version: 1,
    reportType: 'supply',
    title: snapshot.title,
    generatedAt: snapshot.generatedAt,
    filters: snapshot.filters,
    summary: wrapped.join('\n'),
    metrics: [],
    tables: [],
    charts: [],
    warnings: [],
    sourcePeriod: { from: null, to: null },
  }
  return renderAssistantReportPdf(v1)
}

function renderCompositionCsv(snapshot: AssistantCompositionSnapshot, sectionId?: string): string {
  const tables = snapshot.composition.sections.flatMap((section) => section.blocks)
    .filter((block): block is Extract<(typeof snapshot.composition.sections)[number]['blocks'][number], { type: 'table' }> => block.type === 'table')
  const selected = sectionId ? tables.find((table) => table.id === sectionId) : tables[0]
  if (!selected) throw AppError.badRequest('The selected report table is not available')
  const lines = [
    ['Report', snapshot.title],
    ['Generated', snapshot.generatedAt],
    ['Section', selected.title],
    [],
    selected.columns.map((column) => column.label),
    ...selected.rows.map((row) => selected.columns.map((column) => row[column.key])),
  ]
  return `\uFEFF${lines.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
