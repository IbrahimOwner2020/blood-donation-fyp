/**
 * Unit tests for shortage gap + severity (docs/08) — no DB / no network.
 */

import { describe, expect, test } from 'bun:test'

import {
  computeProjectedGap,
  computeShortageGap,
  resolveShortageSeverity,
} from './gap'
import {
  DEFAULT_SHORTAGE_THRESHOLDS,
  normalizeShortageThresholds,
} from './thresholds'

describe('computeProjectedGap', () => {
  test('predicted - available', () => {
    expect(computeProjectedGap(40, 15)).toBe(25)
  })

  test('negative when supply exceeds demand', () => {
    expect(computeProjectedGap(10, 30)).toBe(-20)
  })

  test('floors negative inputs and treats non-finite as 0', () => {
    expect(computeProjectedGap(-5, 3)).toBe(-3)
    expect(computeProjectedGap(Number.NaN, 5)).toBe(-5)
    expect(computeProjectedGap(8, Number.POSITIVE_INFINITY)).toBe(8)
  })
})

describe('resolveShortageSeverity', () => {
  const t = DEFAULT_SHORTAGE_THRESHOLDS

  test('null below lowMin (no shortage / INFO)', () => {
    expect(resolveShortageSeverity(0, t)).toBeNull()
    expect(resolveShortageSeverity(-10, t)).toBeNull()
    expect(resolveShortageSeverity(0.009, t)).toBeNull()
  })

  test('LOW between lowMin and mediumMin', () => {
    expect(resolveShortageSeverity(0.01, t)).toBe('LOW')
    expect(resolveShortageSeverity(9.99, t)).toBe('LOW')
  })

  test('MEDIUM / HIGH / CRITICAL bands', () => {
    expect(resolveShortageSeverity(10, t)).toBe('MEDIUM')
    expect(resolveShortageSeverity(24.9, t)).toBe('MEDIUM')
    expect(resolveShortageSeverity(25, t)).toBe('HIGH')
    expect(resolveShortageSeverity(49.9, t)).toBe('HIGH')
    expect(resolveShortageSeverity(50, t)).toBe('CRITICAL')
    expect(resolveShortageSeverity(500, t)).toBe('CRITICAL')
  })

  test('respects custom thresholds', () => {
    const custom = normalizeShortageThresholds({
      lowMin: 1,
      mediumMin: 5,
      highMin: 10,
      criticalMin: 20,
    })
    expect(resolveShortageSeverity(0.5, custom)).toBeNull()
    expect(resolveShortageSeverity(3, custom)).toBe('LOW')
    expect(resolveShortageSeverity(7, custom)).toBe('MEDIUM')
    expect(resolveShortageSeverity(15, custom)).toBe('HIGH')
    expect(resolveShortageSeverity(20, custom)).toBe('CRITICAL')
  })
})

describe('computeShortageGap', () => {
  test('wires predicted, available, gap, and severity', () => {
    const result = computeShortageGap({
      predictedDemand: 40,
      availableSupply: 15,
    })
    expect(result.predictedUnits).toBe(40)
    expect(result.availableUnits).toBe(15)
    expect(result.projectedGap).toBe(25)
    expect(result.severity).toBe('HIGH')
  })

  test('surplus yields null severity', () => {
    const result = computeShortageGap({
      predictedDemand: 5,
      availableSupply: 20,
    })
    expect(result.projectedGap).toBe(-15)
    expect(result.severity).toBeNull()
  })
})

describe('normalizeShortageThresholds', () => {
  test('enforces non-decreasing ladder', () => {
    const fixed = normalizeShortageThresholds({
      lowMin: 20,
      mediumMin: 5,
      highMin: 10,
      criticalMin: 8,
    })
    expect(fixed.lowMin).toBe(20)
    expect(fixed.mediumMin).toBe(20)
    expect(fixed.highMin).toBe(20)
    expect(fixed.criticalMin).toBe(20)
  })
})
