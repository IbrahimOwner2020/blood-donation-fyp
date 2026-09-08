/**
 * Unit tests for after-alert match-count hook — no DB / no network.
 */

import { describe, expect, test } from 'bun:test'

import type { AlertSeverity, AlertStatus } from '../../db/schema/enums'
import {
  createLogMatchCountAfterAlertUpserted,
  noopAfterAlertUpserted,
} from './matching'
import type { PublicAlert } from './serialize'
import type { UpsertAlertResult } from './service'

function sampleAlert(
  overrides: Partial<PublicAlert> = {},
): PublicAlert {
  return {
    id: 7,
    bloodGroupId: 3,
    bloodGroup: null,
    facilityId: null,
    facility: null,
    predictionId: 1,
    availableUnits: 5,
    predictedUnits: 20,
    projectedGap: 15,
    severity: 'HIGH' as AlertSeverity,
    status: 'OPEN' as AlertStatus,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    resolvedAt: null,
    ...overrides,
  }
}

function sampleResult(
  overrides: Partial<UpsertAlertResult> = {},
): UpsertAlertResult {
  const alert = overrides.alert === undefined ? sampleAlert() : overrides.alert
  return {
    alert,
    action: overrides.action ?? 'created',
    gap: overrides.gap ?? {
      predictedUnits: 20,
      availableUnits: 5,
      projectedGap: 15,
      severity: 'HIGH',
    },
  }
}

describe('noopAfterAlertUpserted', () => {
  test('resolves without work', async () => {
    await expect(
      noopAfterAlertUpserted({
        result: sampleResult(),
        alert: sampleAlert(),
      }),
    ).resolves.toBeUndefined()
  })
})

describe('createLogMatchCountAfterAlertUpserted', () => {
  test('counts for alert blood group and does not throw', async () => {
    const calls: number[] = []
    const hook = createLogMatchCountAfterAlertUpserted({
      countMatches: async (bloodGroupId) => {
        calls.push(bloodGroupId)
        return 4
      },
    })

    await hook({
      result: sampleResult({ action: 'updated' }),
      alert: sampleAlert({ id: 9, bloodGroupId: 2 }),
    })

    expect(calls).toEqual([2])
  })

  test('skips when blood group missing', async () => {
    let called = false
    const hook = createLogMatchCountAfterAlertUpserted({
      countMatches: async () => {
        called = true
        return 0
      },
    })

    await hook({
      result: sampleResult({
        action: 'noop',
        alert: null,
      }),
      alert: null,
    })

    expect(called).toBe(false)
  })

  test('swallows count failures (non-fatal)', async () => {
    const hook = createLogMatchCountAfterAlertUpserted({
      countMatches: async () => {
        throw new Error('db down')
      },
    })

    await expect(
      hook({
        result: sampleResult(),
        alert: sampleAlert(),
      }),
    ).resolves.toBeUndefined()
  })
})
