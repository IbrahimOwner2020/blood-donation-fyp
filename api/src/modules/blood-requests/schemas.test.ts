/**
 * Blood request Zod schema unit tests (no DB / no network).
 */

import { describe, expect, test } from 'bun:test'

import {
  bloodRequestIdParamSchema,
  createBloodRequestBodySchema,
  listBloodRequestsQuerySchema,
  patchBloodRequestBodySchema,
} from './schemas'

describe('bloodRequestIdParamSchema', () => {
  test('accepts positive integer ids', () => {
    expect(bloodRequestIdParamSchema.parse({ id: '7' })).toEqual({ id: 7 })
  })

  test('rejects non-positive ids', () => {
    expect(bloodRequestIdParamSchema.safeParse({ id: '0' }).success).toBe(false)
    expect(bloodRequestIdParamSchema.safeParse({ id: '-3' }).success).toBe(
      false,
    )
  })
})

describe('listBloodRequestsQuerySchema', () => {
  test('defaults pagination', () => {
    const parsed = listBloodRequestsQuerySchema.parse({})
    expect(parsed.limit).toBe(50)
    expect(parsed.offset).toBe(0)
  })

  test('accepts status and priority filters', () => {
    const parsed = listBloodRequestsQuerySchema.parse({
      status: 'PENDING',
      priority: 'URGENT',
      facilityId: '12',
    })
    expect(parsed.status).toBe('PENDING')
    expect(parsed.priority).toBe('URGENT')
    expect(parsed.facilityId).toBe(12)
  })

  test('rejects unknown status', () => {
    expect(
      listBloodRequestsQuerySchema.safeParse({ status: 'OPEN' }).success,
    ).toBe(false)
  })
})

describe('createBloodRequestBodySchema', () => {
  test('defaults priority to MEDIUM', () => {
    const parsed = createBloodRequestBodySchema.parse({
      facilityId: 1,
      bloodGroupId: 2,
      unitsRequested: 3,
    })
    expect(parsed.priority).toBe('MEDIUM')
    expect(parsed.unitsRequested).toBe(3)
  })

  test('rejects zero units', () => {
    expect(
      createBloodRequestBodySchema.safeParse({
        facilityId: 1,
        bloodGroupId: 2,
        unitsRequested: 0,
      }).success,
    ).toBe(false)
  })

  test('parses ISO requestedAt / requiredAt', () => {
    const parsed = createBloodRequestBodySchema.parse({
      facilityId: 1,
      bloodGroupId: 2,
      unitsRequested: 2,
      priority: 'HIGH',
      requestedAt: '2026-09-02T09:00:00.000Z',
      requiredAt: '2026-09-03T09:00:00.000Z',
    })
    expect(parsed.priority).toBe('HIGH')
    expect(parsed.requestedAt).toBeInstanceOf(Date)
    expect(parsed.requiredAt).toBeInstanceOf(Date)
  })
})

describe('patchBloodRequestBodySchema', () => {
  test('requires status', () => {
    expect(patchBloodRequestBodySchema.safeParse({}).success).toBe(false)
    expect(
      patchBloodRequestBodySchema.safeParse({ fulfilledUnits: 1 }).success,
    ).toBe(false)
  })

  test('accepts status with optional fulfilledUnits', () => {
    expect(
      patchBloodRequestBodySchema.parse({
        status: 'PARTIAL',
        fulfilledUnits: 2,
      }),
    ).toEqual({ status: 'PARTIAL', fulfilledUnits: 2 })
    expect(patchBloodRequestBodySchema.parse({ status: 'APPROVED' })).toEqual({
      status: 'APPROVED',
    })
  })
})
