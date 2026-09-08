/**
 * Unit tests for donor-matching filter rules (docs/08) — no DB / no network.
 */

import { describe, expect, test } from 'bun:test'

import type { DonorEligibilityStatus } from '../../db/schema/enums'
import {
  hasContact,
  isDonorMatchCandidate,
  isEligibilityMatchable,
  MATCHABLE_ELIGIBILITY_STATUSES,
  MATCH_DISCLAIMER,
  type DonorMatchCandidateInput,
} from './match-rules'

function candidate(
  overrides: Partial<DonorMatchCandidateInput> = {},
): DonorMatchCandidateInput {
  return {
    bloodGroupId: 1,
    active: true,
    eligibilityStatus: 'POTENTIALLY_ELIGIBLE',
    phone: '+255700000001',
    email: null,
    ...overrides,
  }
}

describe('MATCHABLE_ELIGIBILITY_STATUSES', () => {
  test('only POTENTIALLY_ELIGIBLE', () => {
    expect([...MATCHABLE_ELIGIBILITY_STATUSES]).toEqual([
      'POTENTIALLY_ELIGIBLE',
    ])
  })
})

describe('MATCH_DISCLAIMER', () => {
  test('uses potentially eligible wording and no auto-send', () => {
    expect(MATCH_DISCLAIMER.toLowerCase()).toContain('potentially eligible')
    expect(MATCH_DISCLAIMER.toLowerCase()).toContain('not a medical approval')
    expect(MATCH_DISCLAIMER.toLowerCase()).toContain('never sent automatically')
  })
})

describe('hasContact', () => {
  test('true when phone present', () => {
    expect(hasContact('+255700000001', null)).toBe(true)
    expect(hasContact('  +255  ', undefined)).toBe(true)
  })

  test('true when email present', () => {
    expect(hasContact(null, 'donor@example.com')).toBe(true)
    expect(hasContact(undefined, '  a@b.co  ')).toBe(true)
  })

  test('true when both present', () => {
    expect(hasContact('+255700000001', 'donor@example.com')).toBe(true)
  })

  test('false when both missing or blank', () => {
    expect(hasContact(null, null)).toBe(false)
    expect(hasContact(undefined, undefined)).toBe(false)
    expect(hasContact('', '')).toBe(false)
    expect(hasContact('   ', '  ')).toBe(false)
    expect(hasContact(null, '')).toBe(false)
  })
})

describe('isEligibilityMatchable', () => {
  test('includes POTENTIALLY_ELIGIBLE only', () => {
    expect(isEligibilityMatchable('POTENTIALLY_ELIGIBLE')).toBe(true)
  })

  test('excludes UNKNOWN / INELIGIBLE / TEMPORARILY_INELIGIBLE / null', () => {
    const excluded: Array<DonorEligibilityStatus | null | undefined> = [
      'UNKNOWN',
      'INELIGIBLE',
      'TEMPORARILY_INELIGIBLE',
      null,
      undefined,
    ]
    for (const status of excluded) {
      expect(isEligibilityMatchable(status)).toBe(false)
    }
  })
})

describe('isDonorMatchCandidate', () => {
  const bloodGroupId = 1

  test('includes active potentially-eligible donor with contact and matching group', () => {
    expect(isDonorMatchCandidate(candidate(), bloodGroupId)).toBe(true)
    expect(
      isDonorMatchCandidate(
        candidate({ phone: null, email: 'a@b.co' }),
        bloodGroupId,
      ),
    ).toBe(true)
  })

  test('excludes wrong blood group', () => {
    expect(
      isDonorMatchCandidate(candidate({ bloodGroupId: 2 }), bloodGroupId),
    ).toBe(false)
  })

  test('excludes inactive donors', () => {
    expect(
      isDonorMatchCandidate(candidate({ active: false }), bloodGroupId),
    ).toBe(false)
  })

  test('excludes non-matchable eligibility', () => {
    for (const status of [
      'UNKNOWN',
      'INELIGIBLE',
      'TEMPORARILY_INELIGIBLE',
    ] as const) {
      expect(
        isDonorMatchCandidate(
          candidate({ eligibilityStatus: status }),
          bloodGroupId,
        ),
      ).toBe(false)
    }
  })

  test('excludes donors without contact', () => {
    expect(
      isDonorMatchCandidate(
        candidate({ phone: null, email: null }),
        bloodGroupId,
      ),
    ).toBe(false)
    expect(
      isDonorMatchCandidate(
        candidate({ phone: '  ', email: '' }),
        bloodGroupId,
      ),
    ).toBe(false)
  })

  test('rejects null donor or invalid required blood group', () => {
    expect(isDonorMatchCandidate(null, bloodGroupId)).toBe(false)
    expect(isDonorMatchCandidate(undefined, bloodGroupId)).toBe(false)
    expect(isDonorMatchCandidate(candidate(), 0)).toBe(false)
    expect(isDonorMatchCandidate(candidate(), -1)).toBe(false)
    expect(isDonorMatchCandidate(candidate(), Number.NaN)).toBe(false)
  })
})
