/**
 * Demand aggregation + AI serialize unit tests (no DB).
 */

import { describe, expect, test } from 'bun:test'

import {
  aggregateDemandBuckets,
  collapseBucketsByDateAndGroup,
  DEMAND_SYNC_STATUSES,
  demandBucketKey,
  isDemandSyncStatus,
  toDateOnlyString,
} from './aggregate'
import {
  toAiHistoryPoints,
  toAiTrainingSeries,
  toPublicDemandRecord,
  type PublicDemandRecord,
} from './serialize'

describe('toDateOnlyString', () => {
  test('parses ISO datetime and Date', () => {
    expect(toDateOnlyString('2026-07-01T15:30:00.000Z')).toBe('2026-07-01')
    expect(toDateOnlyString(new Date(Date.UTC(2026, 6, 2)))).toBe('2026-07-02')
  })
})

describe('isDemandSyncStatus', () => {
  test('includes approved operational statuses only', () => {
    expect(DEMAND_SYNC_STATUSES).toEqual([
      'APPROVED',
      'PARTIAL',
      'FULFILLED',
    ])
    expect(isDemandSyncStatus('PENDING')).toBe(false)
    expect(isDemandSyncStatus('CANCELLED')).toBe(false)
    expect(isDemandSyncStatus('FULFILLED')).toBe(true)
  })
})

describe('aggregateDemandBuckets', () => {
  test('sums units per date + blood group + facility', () => {
    const buckets = aggregateDemandBuckets([
      {
        facilityId: 1,
        bloodGroupId: 8,
        unitsRequested: 5,
        fulfilledUnits: 2,
        status: 'PARTIAL',
        requestedAt: '2026-07-01T10:00:00.000Z',
      },
      {
        facilityId: 1,
        bloodGroupId: 8,
        unitsRequested: 3,
        fulfilledUnits: 3,
        status: 'FULFILLED',
        requestedAt: '2026-07-01T18:00:00.000Z',
      },
      {
        facilityId: 2,
        bloodGroupId: 8,
        unitsRequested: 4,
        fulfilledUnits: 0,
        status: 'APPROVED',
        requestedAt: '2026-07-01T12:00:00.000Z',
      },
      {
        facilityId: 1,
        bloodGroupId: 8,
        unitsRequested: 99,
        fulfilledUnits: 0,
        status: 'PENDING',
        requestedAt: '2026-07-01T12:00:00.000Z',
      },
      {
        facilityId: 1,
        bloodGroupId: 8,
        unitsRequested: 1,
        fulfilledUnits: 0,
        status: 'CANCELLED',
        requestedAt: '2026-07-01T12:00:00.000Z',
      },
    ])

    expect(buckets).toHaveLength(2)

    const facility1 = buckets.find((b) => b.facilityId === 1)
    expect(facility1).toEqual({
      facilityId: 1,
      bloodGroupId: 8,
      date: '2026-07-01',
      unitsRequested: 8,
      unitsIssued: 5,
      unfulfilledUnits: 3,
    })

    const facility2 = buckets.find((b) => b.facilityId === 2)
    expect(facility2?.unitsRequested).toBe(4)
    expect(facility2?.unfulfilledUnits).toBe(4)
  })

  test('demandBucketKey is stable', () => {
    expect(demandBucketKey('2026-07-01', 8, 1)).toBe('2026-07-01|8|1')
  })
})

describe('collapseBucketsByDateAndGroup', () => {
  test('sums facilities for national series', () => {
    const collapsed = collapseBucketsByDateAndGroup([
      {
        facilityId: 1,
        bloodGroupId: 8,
        date: '2026-07-01',
        unitsRequested: 8,
        unitsIssued: 5,
        unfulfilledUnits: 3,
      },
      {
        facilityId: 2,
        bloodGroupId: 8,
        date: '2026-07-01',
        unitsRequested: 4,
        unitsIssued: 0,
        unfulfilledUnits: 4,
      },
    ])
    expect(collapsed).toEqual([
      { date: '2026-07-01', bloodGroupId: 8, demandUnits: 12 },
    ])
  })
})

describe('AI serialize helpers', () => {
  const sampleRecords: PublicDemandRecord[] = [
    {
      id: 1,
      facilityId: 1,
      bloodGroupId: 8,
      bloodGroup: { id: 8, code: 'O+', abo: 'O', rh: '+' },
      date: '2026-07-01',
      unitsRequested: 8,
      unitsIssued: 5,
      unitsUsed: null,
      unfulfilledUnits: 3,
      source: 'BLOOD_REQUEST',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      demandUnits: 8,
    },
    {
      id: 2,
      facilityId: 2,
      bloodGroupId: 8,
      bloodGroup: { id: 8, code: 'O+', abo: 'O', rh: '+' },
      date: '2026-07-01',
      unitsRequested: 4,
      unitsIssued: 0,
      unitsUsed: null,
      unfulfilledUnits: 4,
      source: 'BLOOD_REQUEST',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      demandUnits: 4,
    },
    {
      id: 3,
      facilityId: 1,
      bloodGroupId: 8,
      bloodGroup: { id: 8, code: 'O+', abo: 'O', rh: '+' },
      date: '2026-07-02',
      unitsRequested: 5,
      unitsIssued: 5,
      unitsUsed: null,
      unfulfilledUnits: 0,
      source: 'BLOOD_REQUEST',
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      demandUnits: 5,
    },
  ]

  test('toAiHistoryPoints collapses same-day facilities', () => {
    expect(toAiHistoryPoints(sampleRecords)).toEqual([
      { date: '2026-07-01', demand_units: 12 },
      { date: '2026-07-02', demand_units: 5 },
    ])
  })

  test('toAiTrainingSeries matches docs/14 series points', () => {
    const series = toAiTrainingSeries(sampleRecords)
    expect(series[0]).toEqual({
      blood_group: 'O+',
      facility_id: '1',
      date: '2026-07-01',
      demand_units: 8,
    })
    expect(series).toHaveLength(3)
  })

  test('toPublicDemandRecord maps demandUnits from unitsRequested', () => {
    const publicRecord = toPublicDemandRecord({
      id: 10,
      facilityId: null,
      bloodGroupId: 1,
      date: '2026-09-01',
      unitsRequested: 7,
      unitsIssued: 2,
      unitsUsed: null,
      unfulfilledUnits: 5,
      source: 'MANUAL',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    expect(publicRecord?.demandUnits).toBe(7)
    expect(publicRecord?.date).toBe('2026-09-01')
  })
})
