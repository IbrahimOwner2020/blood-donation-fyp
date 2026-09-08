/**
 * Schema + shelf-life unit tests for donations (no DB / no network).
 */

import { describe, expect, test } from 'bun:test'

import {
  createDonationBodySchema,
  donationIdParamSchema,
  listDonationsQuerySchema,
  updateDonationBodySchema,
} from './schemas'
import { toDateOnlyString, toPublicDonation } from './serialize'
import {
  BLOOD_UNIT_SHELF_LIFE_DAYS,
  computeExpiryDate,
} from './shelf-life'

describe('donationIdParamSchema', () => {
  test('coerces positive integer ids', () => {
    expect(donationIdParamSchema.parse({ id: '7' })).toEqual({ id: 7 })
  })

  test('rejects non-positive ids', () => {
    expect(donationIdParamSchema.safeParse({ id: '0' }).success).toBe(false)
    expect(donationIdParamSchema.safeParse({ id: '-3' }).success).toBe(false)
  })
})

describe('createDonationBodySchema', () => {
  test('defaults units to 1 and trims notes', () => {
    const parsed = createDonationBodySchema.parse({
      donorId: 1,
      donationCentreId: 2,
      bloodGroupId: 3,
      donationDate: '2026-09-02',
      notes: '  first unit  ',
    })
    expect(parsed.units).toBe(1)
    expect(parsed.notes).toBe('first unit')
    expect(parsed.facilityId).toBeUndefined()
  })

  test('rejects invalid calendar dates and zero units', () => {
    expect(
      createDonationBodySchema.safeParse({
        donorId: 1,
        donationCentreId: 2,
        bloodGroupId: 3,
        donationDate: '2026-02-30',
      }).success,
    ).toBe(false)

    expect(
      createDonationBodySchema.safeParse({
        donorId: 1,
        donationCentreId: 2,
        bloodGroupId: 3,
        donationDate: '2026-09-02',
        units: 0,
      }).success,
    ).toBe(false)
  })

  test('accepts optional facilityId null', () => {
    const parsed = createDonationBodySchema.parse({
      donorId: 1,
      donationCentreId: 2,
      bloodGroupId: 3,
      donationDate: '2026-09-02',
      units: 2,
      facilityId: null,
    })
    expect(parsed.units).toBe(2)
    expect(parsed.facilityId).toBeNull()
  })
})

describe('updateDonationBodySchema', () => {
  test('requires at least one field', () => {
    expect(updateDonationBodySchema.safeParse({}).success).toBe(false)
    expect(
      updateDonationBodySchema.safeParse({ notes: 'corrected' }).success,
    ).toBe(true)
    expect(
      updateDonationBodySchema.safeParse({ donationCentreId: 4 }).success,
    ).toBe(true)
  })
})

describe('listDonationsQuerySchema', () => {
  test('parses filters and pagination defaults', () => {
    const parsed = listDonationsQuerySchema.parse({
      donorId: '9',
      bloodGroup: 'O+',
      from: '2026-01-01',
      to: '2026-09-02',
    })
    expect(parsed.donorId).toBe(9)
    expect(parsed.bloodGroup).toBe('O+')
    expect(parsed.from).toBe('2026-01-01')
    expect(parsed.limit).toBe(50)
    expect(parsed.offset).toBe(0)
  })
})

describe('computeExpiryDate', () => {
  test(`adds ${BLOOD_UNIT_SHELF_LIFE_DAYS} days to collection date`, () => {
    expect(computeExpiryDate('2026-09-02')).toBe('2026-10-07')
    expect(computeExpiryDate('2026-01-01', 35)).toBe('2026-02-05')
  })
})

describe('toPublicDonation', () => {
  test('formats donationDate and includes inventory metadata', () => {
    const publicDonation = toPublicDonation(
      {
        id: 10,
        donorId: 1,
        donationCentreId: 2,
        bloodGroupId: 3,
        donationDate: '2026-09-02',
        units: 2,
        notes: null,
        createdBy: 5,
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
      },
      {
        bloodGroup: { id: 3, code: 'O+', abo: 'O', rh: '+' },
        donor: {
          id: 1,
          donorNumber: 'DN-1',
          firstName: 'Amina',
          lastName: 'Juma',
        },
        centre: { id: 2, name: 'NBTS Dodoma', region: 'Dodoma' },
      },
      { inventoryUnitCount: 2, inventoryUnitIds: [100, 101] },
    )

    expect(publicDonation?.donationDate).toBe('2026-09-02')
    expect(publicDonation?.bloodGroup?.code).toBe('O+')
    expect(publicDonation?.inventoryUnitCount).toBe(2)
    expect(publicDonation?.inventoryUnitIds).toEqual([100, 101])
    expect(toDateOnlyString(new Date(Date.UTC(2026, 8, 2)))).toBe('2026-09-02')
  })
})
