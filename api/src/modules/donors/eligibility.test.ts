import { describe, expect, test } from 'bun:test'

import {
  addCalendarMonths,
  ageOn,
  calculateDonorEligibility,
} from './eligibility'

const completeDonor = {
  active: true,
  dateOfBirth: '1990-01-01',
  sex: 'MALE' as const,
  weightKg: 60,
  address: 'Dodoma',
  phone: '+255712345678',
  email: 'donor@example.com',
  lastDonationDate: null,
  today: '2026-09-22',
}

describe('donor preliminary eligibility', () => {
  test('accepts the inclusive age boundaries', () => {
    expect(ageOn('2008-09-22', '2026-09-22')).toBe(18)
    expect(ageOn('1961-09-22', '2026-09-22')).toBe(65)
  })

  test('enforces the 50 kg minimum inclusively', () => {
    expect(
      calculateDonorEligibility({ ...completeDonor, weightKg: 50 }).status,
    ).toBe('ELIGIBLE')
    expect(
      calculateDonorEligibility({ ...completeDonor, weightKg: 49.9 }).status,
    ).toBe('UNDERWEIGHT')
  })

  test('uses three calendar months for male donors', () => {
    const result = calculateDonorEligibility({
      ...completeDonor,
      lastDonationDate: '2026-07-31',
      today: '2026-09-22',
    })
    expect(result.nextEligibleDate).toBe('2026-10-31')
    expect(result.status).toBe('WAITING_PERIOD')
  })

  test('uses four calendar months for female donors', () => {
    const result = calculateDonorEligibility({
      ...completeDonor,
      sex: 'FEMALE',
      lastDonationDate: '2026-05-31',
      today: '2026-09-22',
    })
    expect(result.nextEligibleDate).toBe('2026-09-30')
    expect(result.status).toBe('WAITING_PERIOD')
  })

  test('clamps month-end and leap dates', () => {
    expect(addCalendarMonths('2024-11-30', 3)).toBe('2025-02-28')
    expect(addCalendarMonths('2023-11-29', 3)).toBe('2024-02-29')
  })

  test('marks an existing incomplete profile without hiding it', () => {
    const result = calculateDonorEligibility({
      ...completeDonor,
      address: null,
    })
    expect(result.profileComplete).toBe(false)
    expect(result.status).toBe('PROFILE_INCOMPLETE')
  })
})
