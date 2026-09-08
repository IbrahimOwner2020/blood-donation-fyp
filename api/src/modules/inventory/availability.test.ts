/**
 * Unit tests for inventory availability / summary / expiry logic (docs/08).
 * No DB / no network — pure helpers only.
 */

import { describe, expect, test } from 'bun:test'

import {
  addUtcDays,
  classifyUnit,
  filterExpiringUnits,
  filterLowStock,
  isEffectivelyAvailable,
  isExpiringSoon,
  isPastExpiry,
  summarizeByBloodGroup,
  type InventoryUnitSnapshot,
} from './availability'
import { DEFAULT_LOW_STOCK_THRESHOLD } from './constants'
import {
  canTransitionInventoryStatus,
  isTerminalInventoryStatus,
} from './status-machine'

const AS_OF = '2026-09-02'

function unit(
  partial: Partial<InventoryUnitSnapshot> &
    Pick<InventoryUnitSnapshot, 'bloodGroupId' | 'status' | 'expiryDate'>,
): InventoryUnitSnapshot {
  return {
    bloodGroupCode: partial.bloodGroupCode,
    bloodGroupId: partial.bloodGroupId,
    status: partial.status,
    expiryDate: partial.expiryDate,
  }
}

describe('isPastExpiry', () => {
  test('expiry before asOf is past', () => {
    expect(isPastExpiry('2026-09-01', AS_OF)).toBe(true)
  })

  test('expiry on asOf is not past (still usable that day)', () => {
    expect(isPastExpiry('2026-09-02', AS_OF)).toBe(false)
  })

  test('expiry after asOf is not past', () => {
    expect(isPastExpiry('2026-09-10', AS_OF)).toBe(false)
  })
})

describe('isEffectivelyAvailable (docs/08 supply formula)', () => {
  test('AVAILABLE and not expired counts', () => {
    expect(
      isEffectivelyAvailable(
        { status: 'AVAILABLE', expiryDate: '2026-09-20' },
        AS_OF,
      ),
    ).toBe(true)
  })

  test('AVAILABLE but past expiry does NOT count', () => {
    expect(
      isEffectivelyAvailable(
        { status: 'AVAILABLE', expiryDate: '2026-08-01' },
        AS_OF,
      ),
    ).toBe(false)
  })

  test('RESERVED never counts as available supply', () => {
    expect(
      isEffectivelyAvailable(
        { status: 'RESERVED', expiryDate: '2026-09-20' },
        AS_OF,
      ),
    ).toBe(false)
  })

  test('EXPIRED status never counts', () => {
    expect(
      isEffectivelyAvailable(
        { status: 'EXPIRED', expiryDate: '2026-09-20' },
        AS_OF,
      ),
    ).toBe(false)
  })
})

describe('isExpiringSoon', () => {
  test('includes AVAILABLE units within window', () => {
    expect(
      isExpiringSoon(
        { status: 'AVAILABLE', expiryDate: '2026-09-05' },
        AS_OF,
        7,
      ),
    ).toBe(true)
  })

  test('excludes units past expiry even if status AVAILABLE', () => {
    expect(
      isExpiringSoon(
        { status: 'AVAILABLE', expiryDate: '2026-08-30' },
        AS_OF,
        7,
      ),
    ).toBe(false)
  })

  test('excludes units beyond the window', () => {
    expect(
      isExpiringSoon(
        { status: 'AVAILABLE', expiryDate: '2026-09-20' },
        AS_OF,
        7,
      ),
    ).toBe(false)
  })

  test('window end is inclusive', () => {
    const end = addUtcDays(AS_OF, 7)
    expect(end).toBe('2026-09-09')
    expect(
      isExpiringSoon(
        { status: 'AVAILABLE', expiryDate: end },
        AS_OF,
        7,
      ),
    ).toBe(true)
  })
})

describe('classifyUnit', () => {
  test('AVAILABLE past expiry → expired bucket', () => {
    expect(
      classifyUnit({ status: 'AVAILABLE', expiryDate: '2026-08-01' }, AS_OF),
    ).toEqual({
      available: false,
      reserved: false,
      issued: false,
      discarded: false,
      expired: true,
    })
  })

  test('AVAILABLE not expired → available bucket', () => {
    expect(
      classifyUnit({ status: 'AVAILABLE', expiryDate: '2026-10-01' }, AS_OF),
    ).toEqual({
      available: true,
      reserved: false,
      issued: false,
      discarded: false,
      expired: false,
    })
  })
})

describe('summarizeByBloodGroup', () => {
  const fixtures: InventoryUnitSnapshot[] = [
    unit({
      bloodGroupId: 1,
      bloodGroupCode: 'O+',
      status: 'AVAILABLE',
      expiryDate: '2026-09-20',
    }),
    unit({
      bloodGroupId: 1,
      bloodGroupCode: 'O+',
      status: 'AVAILABLE',
      expiryDate: '2026-09-05',
    }),
    // Past expiry — must NOT inflate availableUnits
    unit({
      bloodGroupId: 1,
      bloodGroupCode: 'O+',
      status: 'AVAILABLE',
      expiryDate: '2026-08-01',
    }),
    unit({
      bloodGroupId: 1,
      bloodGroupCode: 'O+',
      status: 'RESERVED',
      expiryDate: '2026-09-15',
    }),
    unit({
      bloodGroupId: 2,
      bloodGroupCode: 'A+',
      status: 'AVAILABLE',
      expiryDate: '2026-09-04',
    }),
    unit({
      bloodGroupId: 2,
      bloodGroupCode: 'A+',
      status: 'ISSUED',
      expiryDate: '2026-09-10',
    }),
    unit({
      bloodGroupId: 2,
      bloodGroupCode: 'A+',
      status: 'EXPIRED',
      expiryDate: '2026-08-15',
    }),
  ]

  test('excludes past-expiry AVAILABLE from availableUnits', () => {
    const rows = summarizeByBloodGroup(fixtures, {
      asOf: AS_OF,
      expiringWithinDays: 7,
      lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    })

    const oPos = rows.find((r) => r.bloodGroupId === 1)
    expect(oPos).toBeDefined()
    expect(oPos?.availableUnits).toBe(2)
    expect(oPos?.expiredUnits).toBe(1)
    expect(oPos?.reservedUnits).toBe(1)
    expect(oPos?.expiringSoonUnits).toBe(1)
  })

  test('marks low-stock when availableUnits <= threshold', () => {
    const rows = summarizeByBloodGroup(fixtures, {
      asOf: AS_OF,
      expiringWithinDays: 7,
      lowStockThreshold: 2,
    })

    const oPos = rows.find((r) => r.bloodGroupId === 1)
    const aPos = rows.find((r) => r.bloodGroupId === 2)

    expect(oPos?.availableUnits).toBe(2)
    expect(oPos?.lowStock).toBe(true)
    expect(aPos?.availableUnits).toBe(1)
    expect(aPos?.lowStock).toBe(true)
    expect(aPos?.issuedUnits).toBe(1)
    expect(aPos?.expiredUnits).toBe(1)
  })

  test('filterLowStock returns only groups at/below threshold', () => {
    const rows = summarizeByBloodGroup(fixtures, {
      asOf: AS_OF,
      expiringWithinDays: 7,
      lowStockThreshold: 1,
    })
    const low = filterLowStock(rows, 1)
    expect(low.map((r) => r.bloodGroupId)).toEqual([2])
  })

  test('filterExpiringUnits excludes past-expiry and non-AVAILABLE', () => {
    const expiring = filterExpiringUnits(fixtures, AS_OF, 7)
    expect(expiring).toHaveLength(2)
    expect(expiring.every((u) => u.status === 'AVAILABLE')).toBe(true)
    expect(expiring.every((u) => !isPastExpiry(u.expiryDate, AS_OF))).toBe(
      true,
    )
  })
})

describe('inventory status machine', () => {
  test('AVAILABLE can move to RESERVED / ISSUED / EXPIRED / DISCARDED', () => {
    expect(canTransitionInventoryStatus('AVAILABLE', 'RESERVED')).toBe(true)
    expect(canTransitionInventoryStatus('AVAILABLE', 'ISSUED')).toBe(true)
    expect(canTransitionInventoryStatus('ISSUED', 'AVAILABLE')).toBe(false)
    expect(isTerminalInventoryStatus('ISSUED')).toBe(true)
    expect(isTerminalInventoryStatus('DISCARDED')).toBe(true)
  })
})
