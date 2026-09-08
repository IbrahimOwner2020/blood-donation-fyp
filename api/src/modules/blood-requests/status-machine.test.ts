/**
 * Blood request status-machine unit tests (docs/12 — request status rules).
 * Pure logic — no DB / no network.
 */

import { describe, expect, test } from 'bun:test'

import { AppError } from '../../lib/errors'
import {
  assertStatusTransition,
  BLOOD_REQUEST_TRANSITIONS,
  canTransition,
  isTerminalStatus,
} from './status-machine'

describe('BLOOD_REQUEST_TRANSITIONS', () => {
  test('covers all documented statuses', () => {
    expect(Object.keys(BLOOD_REQUEST_TRANSITIONS).sort()).toEqual(
      ['APPROVED', 'CANCELLED', 'FULFILLED', 'PARTIAL', 'PENDING'].sort(),
    )
  })

  test('terminals have no outbound edges', () => {
    expect(isTerminalStatus('FULFILLED')).toBe(true)
    expect(isTerminalStatus('CANCELLED')).toBe(true)
    expect(BLOOD_REQUEST_TRANSITIONS.FULFILLED).toEqual([])
    expect(BLOOD_REQUEST_TRANSITIONS.CANCELLED).toEqual([])
  })
})

describe('canTransition', () => {
  test('allows PENDING → APPROVED and CANCELLED', () => {
    expect(canTransition('PENDING', 'APPROVED')).toBe(true)
    expect(canTransition('PENDING', 'CANCELLED')).toBe(true)
  })

  test('rejects PENDING → PARTIAL / FULFILLED / PENDING', () => {
    expect(canTransition('PENDING', 'PARTIAL')).toBe(false)
    expect(canTransition('PENDING', 'FULFILLED')).toBe(false)
    expect(canTransition('PENDING', 'PENDING')).toBe(false)
  })

  test('allows APPROVED → PARTIAL | FULFILLED | CANCELLED', () => {
    expect(canTransition('APPROVED', 'PARTIAL')).toBe(true)
    expect(canTransition('APPROVED', 'FULFILLED')).toBe(true)
    expect(canTransition('APPROVED', 'CANCELLED')).toBe(true)
    expect(canTransition('APPROVED', 'PENDING')).toBe(false)
  })

  test('allows PARTIAL → PARTIAL | FULFILLED | CANCELLED', () => {
    expect(canTransition('PARTIAL', 'PARTIAL')).toBe(true)
    expect(canTransition('PARTIAL', 'FULFILLED')).toBe(true)
    expect(canTransition('PARTIAL', 'CANCELLED')).toBe(true)
    expect(canTransition('PARTIAL', 'APPROVED')).toBe(false)
  })

  test('rejects transitions out of terminals', () => {
    expect(canTransition('FULFILLED', 'CANCELLED')).toBe(false)
    expect(canTransition('CANCELLED', 'PENDING')).toBe(false)
  })
})

describe('assertStatusTransition', () => {
  const base = {
    unitsRequested: 5,
    currentFulfilledUnits: 0,
  }

  test('PENDING → APPROVED keeps fulfilled at 0', () => {
    expect(assertStatusTransition('PENDING', 'APPROVED', base)).toEqual({
      status: 'APPROVED',
      fulfilledUnits: 0,
    })
  })

  test('PENDING → CANCELLED keeps fulfilled at 0', () => {
    expect(assertStatusTransition('PENDING', 'CANCELLED', base)).toEqual({
      status: 'CANCELLED',
      fulfilledUnits: 0,
    })
  })

  test('rejects illegal transition with CONFLICT', () => {
    try {
      assertStatusTransition('PENDING', 'FULFILLED', base)
      throw new Error('expected AppError')
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true)
      if (AppError.isAppError(error)) {
        expect(error.code).toBe('CONFLICT')
        expect(error.details?.[0]?.code).toBe('invalid_status_transition')
      }
    }
  })

  test('APPROVED → PARTIAL requires fulfilledUnits in (0, unitsRequested)', () => {
    expect(
      assertStatusTransition('APPROVED', 'PARTIAL', {
        ...base,
        nextFulfilledUnits: 2,
      }),
    ).toEqual({ status: 'PARTIAL', fulfilledUnits: 2 })

    try {
      assertStatusTransition('APPROVED', 'PARTIAL', {
        ...base,
        nextFulfilledUnits: 5,
      })
      throw new Error('expected AppError')
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true)
      if (AppError.isAppError(error)) {
        expect(error.code).toBe('VALIDATION_ERROR')
        expect(error.details?.[0]?.code).toBe('invalid_partial_units')
      }
    }
  })

  test('PARTIAL → PARTIAL updates fulfilled units', () => {
    expect(
      assertStatusTransition('PARTIAL', 'PARTIAL', {
        unitsRequested: 5,
        currentFulfilledUnits: 2,
        nextFulfilledUnits: 4,
      }),
    ).toEqual({ status: 'PARTIAL', fulfilledUnits: 4 })
  })

  test('APPROVED → FULFILLED defaults fulfilledUnits to unitsRequested', () => {
    expect(
      assertStatusTransition('APPROVED', 'FULFILLED', {
        unitsRequested: 5,
        currentFulfilledUnits: 0,
      }),
    ).toEqual({ status: 'FULFILLED', fulfilledUnits: 5 })
  })

  test('PARTIAL → FULFILLED rejects mismatched fulfilledUnits', () => {
    try {
      assertStatusTransition('PARTIAL', 'FULFILLED', {
        unitsRequested: 5,
        currentFulfilledUnits: 3,
        nextFulfilledUnits: 4,
      })
      throw new Error('expected AppError')
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true)
      if (AppError.isAppError(error)) {
        expect(error.details?.[0]?.code).toBe('invalid_fulfilled_units')
      }
    }
  })

  test('APPROVED/CANCELLED reject changing fulfilledUnits', () => {
    try {
      assertStatusTransition('PENDING', 'APPROVED', {
        ...base,
        nextFulfilledUnits: 1,
      })
      throw new Error('expected AppError')
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true)
      if (AppError.isAppError(error)) {
        expect(error.details?.[0]?.code).toBe('fulfilled_units_not_allowed')
      }
    }
  })

  test('PARTIAL requires fulfilledUnits on the request', () => {
    try {
      assertStatusTransition('APPROVED', 'PARTIAL', {
        unitsRequested: 5,
        currentFulfilledUnits: 0,
      })
      throw new Error('expected AppError')
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true)
      if (AppError.isAppError(error)) {
        expect(error.details?.[0]?.code).toBe('fulfilled_units_required')
      }
    }
  })
})
