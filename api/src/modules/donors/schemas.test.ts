/**
 * Donor Zod + serialize unit tests (no DB / no network).
 */

import { describe, expect, test } from 'bun:test'

import {
  createDonorBodySchema,
  donorIdParamSchema,
  listDonorsQuerySchema,
  updateDonorBodySchema,
} from './schemas'
import { toPublicDonor } from './serialize'

describe('donorIdParamSchema', () => {
  test('accepts positive integer ids', () => {
    expect(donorIdParamSchema.parse({ id: '42' })).toEqual({ id: 42 })
  })

  test('rejects non-positive ids', () => {
    expect(donorIdParamSchema.safeParse({ id: '0' }).success).toBe(false)
    expect(donorIdParamSchema.safeParse({ id: '-1' }).success).toBe(false)
  })
})

describe('listDonorsQuerySchema', () => {
  test('coerces active and pagination defaults', () => {
    const parsed = listDonorsQuerySchema.parse({
      active: 'true',
      bloodGroup: 'O+',
      eligibilityStatus: 'POTENTIALLY_ELIGIBLE',
    })
    expect(parsed.active).toBe(true)
    expect(parsed.bloodGroup).toBe('O+')
    expect(parsed.eligibilityStatus).toBe('POTENTIALLY_ELIGIBLE')
    expect(parsed.limit).toBe(50)
    expect(parsed.offset).toBe(0)
  })

  test('rejects unknown blood group codes', () => {
    expect(
      listDonorsQuerySchema.safeParse({ bloodGroup: 'X+' }).success,
    ).toBe(false)
  })

  test('coerces active=false without truthy-string trap', () => {
    expect(listDonorsQuerySchema.parse({ active: 'false' }).active).toBe(false)
    expect(listDonorsQuerySchema.parse({ active: '0' }).active).toBe(false)
  })

  test('accepts donationCentreId filter', () => {
    const parsed = listDonorsQuerySchema.parse({ donationCentreId: '3' })
    expect(parsed.donationCentreId).toBe(3)
  })

  test('rejects non-positive donationCentreId', () => {
    expect(
      listDonorsQuerySchema.safeParse({ donationCentreId: '0' }).success,
    ).toBe(false)
  })
})

describe('createDonorBodySchema', () => {
  test('defaults eligibility UNKNOWN and active true', () => {
    const parsed = createDonorBodySchema.parse({
      donorNumber: 'DN-001',
      firstName: 'Amina',
      lastName: 'Juma',
      bloodGroupId: 1,
    })
    expect(parsed.eligibilityStatus).toBe('UNKNOWN')
    expect(parsed.active).toBe(true)
    expect(parsed.phone).toBeUndefined()
    expect(parsed.email).toBeUndefined()
  })

  test('normalizes empty phone/email to null', () => {
    const parsed = createDonorBodySchema.parse({
      donorNumber: 'DN-002',
      firstName: 'Amina',
      lastName: 'Juma',
      bloodGroupId: 1,
      phone: '   ',
      email: '',
    })
    expect(parsed.phone).toBeNull()
    expect(parsed.email).toBeNull()
  })

  test('accepts POTENTIALLY_ELIGIBLE as operational status only', () => {
    const parsed = createDonorBodySchema.parse({
      donorNumber: 'DN-003',
      firstName: 'Amina',
      lastName: 'Juma',
      bloodGroupId: 2,
      eligibilityStatus: 'POTENTIALLY_ELIGIBLE',
      phone: '+255700000001',
      email: 'amina@example.com',
    })
    expect(parsed.eligibilityStatus).toBe('POTENTIALLY_ELIGIBLE')
    expect(parsed.phone).toBe('+255700000001')
    expect(parsed.email).toBe('amina@example.com')
  })

  test('rejects blank donor number', () => {
    expect(
      createDonorBodySchema.safeParse({
        donorNumber: '  ',
        firstName: 'Amina',
        lastName: 'Juma',
        bloodGroupId: 1,
      }).success,
    ).toBe(false)
  })
})

describe('updateDonorBodySchema', () => {
  test('requires at least one field', () => {
    expect(updateDonorBodySchema.safeParse({}).success).toBe(false)
  })

  test('accepts soft-deactivate patch', () => {
    expect(updateDonorBodySchema.parse({ active: false })).toEqual({
      active: false,
    })
  })
})

describe('toPublicDonor', () => {
  test('maps donor + blood group and falls back safely', () => {
    const publicDonor = toPublicDonor(
      {
        id: 7,
        donorNumber: 'DN-007',
        firstName: 'Amina',
        lastName: 'Juma',
        phone: null,
        email: null,
        bloodGroupId: 3,
        eligibilityStatus: 'POTENTIALLY_ELIGIBLE',
        active: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      { id: 3, code: 'B+', abo: 'B', rh: '+' },
    )

    expect(publicDonor?.id).toBe(7)
    expect(publicDonor?.bloodGroup?.code).toBe('B+')
    expect(publicDonor?.eligibilityStatus).toBe('POTENTIALLY_ELIGIBLE')
  })

  test('returns null for missing donor', () => {
    expect(toPublicDonor(null)).toBeNull()
    expect(toPublicDonor(undefined)).toBeNull()
  })
})
