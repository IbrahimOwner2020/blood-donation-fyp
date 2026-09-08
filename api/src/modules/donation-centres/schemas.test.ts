/**
 * Schema-only tests for donation centre Zod validation (no DB).
 */

import { describe, expect, test } from 'bun:test'

import {
  createDonationCentreBodySchema,
  listDonationCentresQuerySchema,
  patchDonationCentreBodySchema,
  donationCentreIdParamSchema,
} from './schemas'

describe('donation-centres schemas', () => {
  test('create body requires name and region', () => {
    const ok = createDonationCentreBodySchema.safeParse({
      name: '  NBTS Centre  ',
      region: ' Dodoma ',
    })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.name).toBe('NBTS Centre')
      expect(ok.data.region).toBe('Dodoma')
      expect(ok.data.active).toBe(true)
      expect(ok.data.address).toBeUndefined()
    }

    const missing = createDonationCentreBodySchema.safeParse({
      name: '',
      region: 'Dar',
    })
    expect(missing.success).toBe(false)
  })

  test('list query parses active true/false strings', () => {
    const active = listDonationCentresQuerySchema.safeParse({ active: 'true' })
    expect(active.success).toBe(true)
    if (active.success) {
      expect(active.data.active).toBe(true)
    }

    const inactive = listDonationCentresQuerySchema.safeParse({
      active: 'false',
      region: 'Mwanza',
    })
    expect(inactive.success).toBe(true)
    if (inactive.success) {
      expect(inactive.data.active).toBe(false)
      expect(inactive.data.region).toBe('Mwanza')
    }

    const bad = listDonationCentresQuerySchema.safeParse({ active: 'yes' })
    expect(bad.success).toBe(false)
  })

  test('patch requires at least one field', () => {
    const empty = patchDonationCentreBodySchema.safeParse({})
    expect(empty.success).toBe(false)

    const softOff = patchDonationCentreBodySchema.safeParse({ active: false })
    expect(softOff.success).toBe(true)
  })

  test('id param coerces positive integers', () => {
    const ok = donationCentreIdParamSchema.safeParse({ id: '12' })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.id).toBe(12)
    }

    const bad = donationCentreIdParamSchema.safeParse({ id: '0' })
    expect(bad.success).toBe(false)
  })
})
