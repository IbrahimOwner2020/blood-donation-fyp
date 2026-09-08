/**
 * Zod schema unit tests for shortage alerts (no DB / no network).
 */

import { describe, expect, test } from 'bun:test'

import {
  alertIdParamSchema,
  listAlertMatchesQuerySchema,
  listAlertsQuerySchema,
  patchAlertStatusBodySchema,
  recalculateAlertsBodySchema,
} from './schemas'
import {
  assertAlertStatusTransition,
  canTransitionAlertStatus,
} from './status-machine'

describe('alertIdParamSchema', () => {
  test('coerces positive integer ids', () => {
    expect(alertIdParamSchema.parse({ id: '12' })).toEqual({ id: 12 })
  })

  test('rejects non-positive ids', () => {
    expect(alertIdParamSchema.safeParse({ id: '0' }).success).toBe(false)
  })
})

describe('listAlertsQuerySchema', () => {
  test('parses activeOnly and defaults pagination', () => {
    const parsed = listAlertsQuerySchema.parse({ activeOnly: 'true' })
    expect(parsed.activeOnly).toBe(true)
    expect(parsed.limit).toBe(50)
    expect(parsed.offset).toBe(0)
  })
})

describe('listAlertMatchesQuerySchema', () => {
  test('defaults pagination', () => {
    expect(listAlertMatchesQuerySchema.parse({})).toEqual({
      limit: 50,
      offset: 0,
    })
  })

  test('coerces limit and offset', () => {
    expect(
      listAlertMatchesQuerySchema.parse({ limit: '25', offset: '10' }),
    ).toEqual({ limit: 25, offset: 10 })
  })

  test('rejects invalid pagination', () => {
    expect(
      listAlertMatchesQuerySchema.safeParse({ limit: '0' }).success,
    ).toBe(false)
    expect(
      listAlertMatchesQuerySchema.safeParse({ offset: '-1' }).success,
    ).toBe(false)
  })
})

describe('patchAlertStatusBodySchema', () => {
  test('accepts lifecycle statuses', () => {
    expect(patchAlertStatusBodySchema.parse({ status: 'ACKNOWLEDGED' })).toEqual(
      { status: 'ACKNOWLEDGED' },
    )
  })

  test('rejects unknown status', () => {
    expect(
      patchAlertStatusBodySchema.safeParse({ status: 'INFO' }).success,
    ).toBe(false)
  })
})

describe('recalculateAlertsBodySchema', () => {
  test('allows empty body (recalculate all)', () => {
    expect(recalculateAlertsBodySchema.parse({})).toEqual({})
  })

  test('rejects bloodGroupId and bloodGroup together', () => {
    expect(
      recalculateAlertsBodySchema.safeParse({
        bloodGroupId: 1,
        bloodGroup: 'O+',
      }).success,
    ).toBe(false)
  })
})

describe('alert status machine', () => {
  test('OPEN can acknowledge / resolve / dismiss', () => {
    expect(canTransitionAlertStatus('OPEN', 'ACKNOWLEDGED')).toBe(true)
    expect(canTransitionAlertStatus('OPEN', 'RESOLVED')).toBe(true)
    expect(canTransitionAlertStatus('OPEN', 'DISMISSED')).toBe(true)
  })

  test('terminal states cannot transition', () => {
    expect(canTransitionAlertStatus('RESOLVED', 'OPEN')).toBe(false)
    expect(() => assertAlertStatusTransition('DISMISSED', 'ACKNOWLEDGED')).toThrow()
  })
})
