/**
 * Demand schema unit tests (no DB / no network).
 */

import { describe, expect, test } from 'bun:test'

import {
  exportDemandQuerySchema,
  listDemandRecordsQuerySchema,
  syncDemandBodySchema,
} from './schemas'

describe('listDemandRecordsQuerySchema', () => {
  test('defaults pagination', () => {
    const parsed = listDemandRecordsQuerySchema.parse({})
    expect(parsed.limit).toBe(100)
    expect(parsed.offset).toBe(0)
  })

  test('accepts blood group code and date range', () => {
    const parsed = listDemandRecordsQuerySchema.parse({
      bloodGroup: 'O+',
      from: '2026-07-01',
      to: '2026-07-31',
      facilityId: '3',
    })
    expect(parsed.bloodGroup).toBe('O+')
    expect(parsed.from).toBe('2026-07-01')
    expect(parsed.to).toBe('2026-07-31')
    expect(parsed.facilityId).toBe(3)
  })

  test('rejects from after to', () => {
    expect(
      listDemandRecordsQuerySchema.safeParse({
        from: '2026-08-01',
        to: '2026-07-01',
      }).success,
    ).toBe(false)
  })

  test('rejects both bloodGroupId and bloodGroup', () => {
    expect(
      listDemandRecordsQuerySchema.safeParse({
        bloodGroupId: '1',
        bloodGroup: 'A+',
      }).success,
    ).toBe(false)
  })
})

describe('exportDemandQuerySchema', () => {
  test('defaults format to history and requires blood group', () => {
    expect(exportDemandQuerySchema.safeParse({}).success).toBe(false)

    const parsed = exportDemandQuerySchema.parse({ bloodGroup: 'B-' })
    expect(parsed.format).toBe('history')
    expect(parsed.bloodGroup).toBe('B-')
  })

  test('allows series without blood group', () => {
    const parsed = exportDemandQuerySchema.parse({ format: 'series' })
    expect(parsed.format).toBe('series')
  })
})

describe('syncDemandBodySchema', () => {
  test('accepts empty body', () => {
    expect(syncDemandBodySchema.parse({})).toEqual({})
  })

  test('accepts optional window filters', () => {
    const parsed = syncDemandBodySchema.parse({
      from: '2026-01-01',
      to: '2026-01-31',
      bloodGroup: 'AB+',
    })
    expect(parsed.from).toBe('2026-01-01')
    expect(parsed.bloodGroup).toBe('AB+')
  })

  test('rejects unknown keys', () => {
    expect(
      syncDemandBodySchema.safeParse({ unexpected: true }).success,
    ).toBe(false)
  })
})
