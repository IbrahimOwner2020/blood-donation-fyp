/**
 * Facility Zod schema unit tests (no DB / no network).
 */

import { describe, expect, test } from 'bun:test'

import {
  createFacilityBodySchema,
  facilityIdParamSchema,
  listFacilitiesQuerySchema,
  patchFacilityBodySchema,
} from './schemas'

describe('facilityIdParamSchema', () => {
  test('accepts positive integer ids', () => {
    expect(facilityIdParamSchema.parse({ id: '42' })).toEqual({ id: 42 })
  })

  test('rejects non-positive ids', () => {
    expect(facilityIdParamSchema.safeParse({ id: '0' }).success).toBe(false)
    expect(facilityIdParamSchema.safeParse({ id: '-1' }).success).toBe(false)
  })
})

describe('listFacilitiesQuerySchema', () => {
  test('coerces active query strings', () => {
    expect(listFacilitiesQuerySchema.parse({ active: 'true' }).active).toBe(true)
    expect(listFacilitiesQuerySchema.parse({ active: '0' }).active).toBe(false)
  })

  test('allows empty filters', () => {
    const parsed = listFacilitiesQuerySchema.parse({})
    expect(parsed.region).toBeUndefined()
    expect(parsed.district).toBeUndefined()
    expect(parsed.active).toBeUndefined()
    expect(parsed.q).toBeUndefined()
  })
})

describe('createFacilityBodySchema', () => {
  test('defaults active to true', () => {
    const parsed = createFacilityBodySchema.parse({
      name: 'Test Hospital',
      region: 'Dar es Salaam',
      district: 'Ilala',
    })
    expect(parsed.active).toBe(true)
  })

  test('rejects blank name', () => {
    expect(
      createFacilityBodySchema.safeParse({
        name: '   ',
        region: 'Dar es Salaam',
        district: 'Ilala',
      }).success,
    ).toBe(false)
  })
})

describe('patchFacilityBodySchema', () => {
  test('requires at least one field', () => {
    expect(patchFacilityBodySchema.safeParse({}).success).toBe(false)
  })

  test('accepts partial active toggle', () => {
    expect(patchFacilityBodySchema.parse({ active: false })).toEqual({
      active: false,
    })
  })
})
