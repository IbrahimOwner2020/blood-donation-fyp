import { describe, expect, test } from 'bun:test'

import {
  DEMO_60_DAY_WINDOW,
  DEMO_BLOOD_GROUPS,
  generate60DayDemoDataset,
  parseDemoDataAnchor,
} from './demo-operations-60-day'

const ANCHOR = '2026-09-28'

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000)
}

describe('60-day operational demo generator', () => {
  test('is deterministic and produces the expected moderate dataset', () => {
    const first = generate60DayDemoDataset(ANCHOR)
    const second = generate60DayDemoDataset(ANCHOR)

    expect(first).toEqual(second)
    expect(first.donors).toHaveLength(96)
    expect(first.donations).toHaveLength(72)
    expect(first.requests).toHaveLength(240)
    expect(first.demand).toHaveLength(480)
    expect(first.predictions).toHaveLength(72)
    expect(first.alerts).toHaveLength(24)
    expect(first.notifications).toHaveLength(96)
    expect(first.aiRuns).toHaveLength(9)
  })

  test('covers every blood group and exactly 60 complete UTC demand days', () => {
    const dataset = generate60DayDemoDataset(ANCHOR)
    expect(new Set(dataset.donors.map((row) => row.bloodGroupCode))).toEqual(new Set(DEMO_BLOOD_GROUPS))
    expect(new Set(dataset.demand.map((row) => row.bloodGroupCode))).toEqual(new Set(DEMO_BLOOD_GROUPS))
    expect(new Set(dataset.demand.map((row) => row.date)).size).toBe(DEMO_60_DAY_WINDOW)
    expect(dataset.demand.every((row) => {
      const age = daysBetween(row.date, ANCHOR)
      return age >= 0 && age < DEMO_60_DAY_WINDOW
    })).toBe(true)
  })

  test('keeps all generated operational timestamps inside the window and identifiers unique', () => {
    const dataset = generate60DayDemoDataset(ANCHOR)
    const dates = [
      ...dataset.donors.map((row) => row.createdAt.toISOString().slice(0, 10)),
      ...dataset.donations.map((row) => row.donationDate),
      ...dataset.requests.map((row) => row.requestedAt.toISOString().slice(0, 10)),
      ...dataset.demand.map((row) => row.date),
      ...dataset.predictions.map((row) => row.createdAt.toISOString().slice(0, 10)),
      ...dataset.alerts.map((row) => row.createdAt.toISOString().slice(0, 10)),
      ...dataset.notifications.map((row) => row.createdAt.toISOString().slice(0, 10)),
      ...dataset.aiRuns.map((row) => row.startedAt.toISOString().slice(0, 10)),
    ]
    expect(dates.every((date) => {
      const age = daysBetween(date, ANCHOR)
      return age >= 0 && age < DEMO_60_DAY_WINDOW
    })).toBe(true)

    const keys = [
      ...dataset.donors.map((row) => row.donorNumber),
      ...dataset.donations.map((row) => row.key),
      ...dataset.requests.map((row) => row.key),
      ...dataset.demand.map((row) => row.key),
      ...dataset.predictions.map((row) => row.key),
      ...dataset.alerts.map((row) => row.key),
      ...dataset.notifications.map((row) => row.key),
      ...dataset.aiRuns.map((row) => row.key),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('keeps inventory and request lifecycle values internally consistent', () => {
    const dataset = generate60DayDemoDataset(ANCHOR)
    for (const donation of dataset.donations) {
      const age = daysBetween(donation.donationDate, ANCHOR)
      if (donation.inventoryStatus === 'AVAILABLE' || donation.inventoryStatus === 'RESERVED') {
        expect(age).toBeLessThanOrEqual(35)
      }
      if (age > 35) expect(['EXPIRED', 'ISSUED']).toContain(donation.inventoryStatus)
    }
    for (const request of dataset.requests) {
      if (request.status === 'FULFILLED') expect(request.fulfilledUnits).toBe(request.unitsRequested)
      if (request.status === 'PARTIAL') {
        expect(request.fulfilledUnits).toBeGreaterThan(0)
        expect(request.fulfilledUnits).toBeLessThan(request.unitsRequested)
      }
      if (['PENDING', 'APPROVED', 'CANCELLED'].includes(request.status)) expect(request.fulfilledUnits).toBe(0)
    }
  })

  test('includes reportable lifecycle variation without executable external sends', () => {
    const dataset = generate60DayDemoDataset(ANCHOR)
    expect(new Set(dataset.alerts.map((row) => row.status))).toEqual(
      new Set(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']),
    )
    expect(new Set(dataset.notifications.map((row) => row.status))).toEqual(
      new Set(['SENT', 'FAILED', 'PENDING', 'CANCELLED']),
    )
    expect(dataset.aiRuns.every((row) => row.notificationMode === 'REPORT_ONLY')).toBe(true)
    expect(dataset.predictions.every((row) => row.modelVersion.startsWith('demo-60d-'))).toBe(true)
  })

  test('validates an optional anchor and otherwise uses the current UTC date', () => {
    expect(parseDemoDataAnchor(undefined, new Date('2026-09-28T23:59:59.000Z'))).toBe(ANCHOR)
    expect(parseDemoDataAnchor(ANCHOR)).toBe(ANCHOR)
    expect(() => parseDemoDataAnchor('2026-02-30')).toThrow('valid calendar date')
    expect(() => parseDemoDataAnchor('28-09-2026')).toThrow('YYYY-MM-DD')
  })
})
