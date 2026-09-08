/**
 * Reports module — unit tests for Zod query schemas (docs/04 Reports).
 */

import { describe, expect, test } from 'bun:test'

import {
  donationsReportQuerySchema,
  inventoryReportQuerySchema,
  notificationsReportQuerySchema,
} from './schemas'

describe('inventoryReportQuerySchema', () => {
  test('accepts empty query', () => {
    const result = inventoryReportQuerySchema.safeParse({})
    expect(result.success).toBe(true)
  })

  test('accepts asOf and bloodGroup', () => {
    const result = inventoryReportQuerySchema.safeParse({
      asOf: '2026-09-01',
      bloodGroup: 'O+',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.asOf).toBe('2026-09-01')
      expect(result.data.bloodGroup).toBe('O+')
    }
  })

  test('rejects invalid blood group', () => {
    const result = inventoryReportQuerySchema.safeParse({
      bloodGroup: 'Z+',
    })
    expect(result.success).toBe(false)
  })
})

describe('donationsReportQuerySchema', () => {
  test('rejects from after to', () => {
    const result = donationsReportQuerySchema.safeParse({
      from: '2026-09-10',
      to: '2026-09-01',
    })
    expect(result.success).toBe(false)
  })

  test('accepts valid date range', () => {
    const result = donationsReportQuerySchema.safeParse({
      from: '2026-08-01',
      to: '2026-09-01',
      bloodGroup: 'A+',
    })
    expect(result.success).toBe(true)
  })
})

describe('notificationsReportQuerySchema', () => {
  test('accepts channel and status', () => {
    const result = notificationsReportQuerySchema.safeParse({
      channel: 'EMAIL',
      status: 'SENT',
      from: '2026-01-01',
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid channel', () => {
    const result = notificationsReportQuerySchema.safeParse({
      channel: 'PUSH',
    })
    expect(result.success).toBe(false)
  })
})
