/**
 * Dashboard aggregation helper unit tests (no DB).
 */

import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_DASHBOARD_PERIOD_DAYS,
  MAX_TREND_DAYS,
  addUtcDays,
  bucketTrendByDate,
  fillTrendRange,
  filterTrendToPeriod,
  inclusiveDaySpan,
  isValidDateOnly,
  resolvePeriod,
  sumTrendUnits,
  toDateOnlyString,
  utcTodayDateOnly,
} from './aggregate'

describe('toDateOnlyString', () => {
  test('parses ISO datetime and Date', () => {
    expect(toDateOnlyString('2026-07-01T15:30:00.000Z')).toBe('2026-07-01')
    expect(toDateOnlyString(new Date(Date.UTC(2026, 6, 2)))).toBe('2026-07-02')
    expect(toDateOnlyString(null)).toBe('')
    expect(toDateOnlyString(undefined)).toBe('')
  })
})

describe('isValidDateOnly', () => {
  test('rejects non-calendar and malformed values', () => {
    expect(isValidDateOnly('2026-09-02')).toBe(true)
    expect(isValidDateOnly('2026-02-30')).toBe(false)
    expect(isValidDateOnly('09-02-2026')).toBe(false)
    expect(isValidDateOnly('')).toBe(false)
  })
})

describe('addUtcDays / inclusiveDaySpan', () => {
  test('adds days across month boundaries', () => {
    expect(addUtcDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(inclusiveDaySpan('2026-09-01', '2026-09-01')).toBe(1)
    expect(inclusiveDaySpan('2026-09-01', '2026-09-30')).toBe(30)
  })
})

describe('resolvePeriod', () => {
  test('defaults to last N days ending today', () => {
    const now = new Date(Date.UTC(2026, 8, 2))
    const period = resolvePeriod({ now })
    expect(period.to).toBe('2026-09-02')
    expect(period.from).toBe(
      addUtcDays('2026-09-02', -(DEFAULT_DASHBOARD_PERIOD_DAYS - 1)),
    )
  })

  test('honors explicit from/to and clamps inverted range', () => {
    expect(resolvePeriod({ from: '2026-08-01', to: '2026-08-15' })).toEqual({
      from: '2026-08-01',
      to: '2026-08-15',
    })
    expect(resolvePeriod({ from: '2026-08-20', to: '2026-08-10' })).toEqual({
      from: '2026-08-10',
      to: '2026-08-10',
    })
  })

  test('caps span to MAX_TREND_DAYS', () => {
    const period = resolvePeriod({
      from: '2020-01-01',
      to: '2026-09-02',
    })
    expect(inclusiveDaySpan(period.from, period.to)).toBe(MAX_TREND_DAYS)
    expect(period.to).toBe('2026-09-02')
  })
})

describe('bucketTrendByDate', () => {
  test('sums units per day and skips invalid rows', () => {
    const points = bucketTrendByDate([
      { date: '2026-07-01', units: 2 },
      { date: '2026-07-01T18:00:00.000Z', units: 3 },
      { date: '2026-07-02', units: 1 },
      { date: 'bad', units: 9 },
      { date: '2026-07-03' },
      { date: null, units: 4 },
    ])
    expect(points).toEqual([
      { date: '2026-07-01', units: 5 },
      { date: '2026-07-02', units: 1 },
      { date: '2026-07-03', units: 1 },
    ])
  })
})

describe('fillTrendRange / filterTrendToPeriod / sumTrendUnits', () => {
  test('zero-fills missing days and sums', () => {
    const filled = fillTrendRange('2026-07-01', '2026-07-03', [
      { date: '2026-07-01', units: 4 },
      { date: '2026-07-03', units: 2 },
    ])
    expect(filled).toEqual([
      { date: '2026-07-01', units: 4 },
      { date: '2026-07-02', units: 0 },
      { date: '2026-07-03', units: 2 },
    ])
    expect(sumTrendUnits(filled)).toBe(6)

    const filtered = filterTrendToPeriod(filled, '2026-07-02', '2026-07-03')
    expect(filtered).toEqual([
      { date: '2026-07-02', units: 0 },
      { date: '2026-07-03', units: 2 },
    ])
  })

  test('returns empty for inverted fill range', () => {
    expect(fillTrendRange('2026-07-05', '2026-07-01', [])).toEqual([])
  })
})

describe('utcTodayDateOnly', () => {
  test('uses UTC calendar day', () => {
    expect(utcTodayDateOnly(new Date(Date.UTC(2026, 0, 15, 23, 59)))).toBe(
      '2026-01-15',
    )
  })
})
