/**
 * Pure dashboard aggregation helpers (docs/04 Dashboard, TODO.md §9).
 * No DB — unit-testable period resolution and trend bucketing.
 */

/** Default KPI / trend lookback when `from` is omitted (calendar days inclusive of `to`). */
export const DEFAULT_DASHBOARD_PERIOD_DAYS = 30

/** Cap on trend series length to keep responses bounded. */
export const MAX_TREND_DAYS = 366

export type DateOnlyPeriod = {
  /** Inclusive start YYYY-MM-DD */
  from: string
  /** Inclusive end YYYY-MM-DD */
  to: string
}

export type TrendPoint = {
  /** YYYY-MM-DD */
  date: string
  units: number
}

export type TrendBucketInput = {
  /** YYYY-MM-DD or Date / ISO datetime */
  date: Date | string | null | undefined
  units?: number | null | undefined
}

/** Normalize MySQL DATE / Date / datetime to YYYY-MM-DD (UTC for Date). */
export function toDateOnlyString(
  value: Date | string | null | undefined,
): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())
    return match?.[1] ?? value.trim().slice(0, 10)
  }
  if (Number.isNaN(value.getTime())) {
    return ''
  }
  const y = value.getUTCFullYear()
  const m = String(value.getUTCMonth() + 1).padStart(2, '0')
  const d = String(value.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function utcTodayDateOnly(now: Date = new Date()): string {
  return toDateOnlyString(now)
}

export function addUtcDays(dateOnly: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly.trim())
  if (!match) {
    throw new Error(`Invalid date: ${dateOnly}`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const dt = new Date(Date.UTC(year, month - 1, day + days))
  return toDateOnlyString(dt)
}

export function isValidDateOnly(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const [y, m, d] = value.split('-').map(Number)
  if (
    typeof y !== 'number' ||
    typeof m !== 'number' ||
    typeof d !== 'number' ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return false
  }
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  )
}

/** Inclusive day count between two YYYY-MM-DD dates (UTC). */
export function inclusiveDaySpan(from: string, to: string): number {
  const fromMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from)
  const toMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to)
  if (!fromMatch || !toMatch) {
    return 0
  }
  const fromMs = Date.UTC(
    Number(fromMatch[1]),
    Number(fromMatch[2]) - 1,
    Number(fromMatch[3]),
  )
  const toMs = Date.UTC(
    Number(toMatch[1]),
    Number(toMatch[2]) - 1,
    Number(toMatch[3]),
  )
  if (toMs < fromMs) {
    return 0
  }
  return Math.floor((toMs - fromMs) / 86_400_000) + 1
}

/**
 * Resolve inclusive [from, to] for dashboard queries.
 * Defaults: `to` = today UTC; `from` = to − (defaultDays − 1).
 */
export function resolvePeriod(
  input: {
    from?: string | null | undefined
    to?: string | null | undefined
    defaultDays?: number
    now?: Date
  } = {},
): DateOnlyPeriod {
  const defaultDays = Math.max(
    1,
    Math.min(
      MAX_TREND_DAYS,
      Math.trunc(input.defaultDays ?? DEFAULT_DASHBOARD_PERIOD_DAYS),
    ),
  )
  const to =
    input.to && isValidDateOnly(input.to)
      ? input.to
      : utcTodayDateOnly(input.now ?? new Date())

  let from =
    input.from && isValidDateOnly(input.from)
      ? input.from
      : addUtcDays(to, -(defaultDays - 1))

  if (from > to) {
    from = to
  }

  const span = inclusiveDaySpan(from, to)
  if (span > MAX_TREND_DAYS) {
    from = addUtcDays(to, -(MAX_TREND_DAYS - 1))
  }

  return { from, to }
}

/**
 * Sum units into daily buckets. Skips invalid dates / non-finite units.
 */
export function bucketTrendByDate(
  rows: TrendBucketInput[] | null | undefined,
): TrendPoint[] {
  const map = new Map<string, number>()

  for (const row of rows ?? []) {
    if (!row) {
      continue
    }
    const date = toDateOnlyString(row.date)
    if (!isValidDateOnly(date)) {
      continue
    }
    const raw =
      row.units === null || row.units === undefined ? 1 : Number(row.units)
    if (!Number.isFinite(raw)) {
      continue
    }
    const units = Math.max(0, Math.trunc(raw))
    map.set(date, (map.get(date) ?? 0) + units)
  }

  return [...map.entries()]
    .map(([date, units]) => ({ date, units }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * Zero-fill every calendar day in [from, to] so charts have a continuous series.
 */
export function fillTrendRange(
  from: string,
  to: string,
  points: TrendPoint[] | null | undefined,
): TrendPoint[] {
  if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to) {
    return []
  }

  const byDate = new Map<string, number>()
  for (const point of points ?? []) {
    if (!point?.date || !isValidDateOnly(point.date)) {
      continue
    }
    byDate.set(point.date, Math.max(0, Math.trunc(point.units ?? 0)))
  }

  const filled: TrendPoint[] = []
  let cursor = from
  while (cursor <= to) {
    filled.push({ date: cursor, units: byDate.get(cursor) ?? 0 })
    cursor = addUtcDays(cursor, 1)
    if (filled.length > MAX_TREND_DAYS) {
      break
    }
  }
  return filled
}

export function sumTrendUnits(
  points: TrendPoint[] | null | undefined,
): number {
  let total = 0
  for (const point of points ?? []) {
    if (!point) {
      continue
    }
    const units = Math.trunc(Number(point.units) || 0)
    if (units > 0) {
      total += units
    }
  }
  return total
}

/**
 * Keep only points whose date falls in [from, to] (inclusive).
 */
export function filterTrendToPeriod(
  points: TrendPoint[] | null | undefined,
  from: string,
  to: string,
): TrendPoint[] {
  return (points ?? []).filter((point) => {
    if (!point?.date || !isValidDateOnly(point.date)) {
      return false
    }
    return point.date >= from && point.date <= to
  })
}
