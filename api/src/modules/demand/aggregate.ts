/**
 * Pure aggregation helpers: blood requests → demand time-series buckets.
 * Usable by sync service and unit tests (no DB).
 *
 * Demand date = calendar day of `requestedAt` (UTC YYYY-MM-DD).
 * Included statuses: APPROVED | PARTIAL | FULFILLED (TODO.md §5 approved ops data).
 */

import type { BloodRequestStatus } from '../../db/schema/enums'

/** Statuses that contribute to consistent AI demand history. */
export const DEMAND_SYNC_STATUSES: readonly BloodRequestStatus[] = [
  'APPROVED',
  'PARTIAL',
  'FULFILLED',
] as const

export type DemandRequestInput = {
  facilityId: number
  bloodGroupId: number
  unitsRequested: number
  fulfilledUnits: number
  status: BloodRequestStatus
  /** ISO date YYYY-MM-DD or Date / timestamp string. */
  requestedAt: Date | string
}

export type DemandBucket = {
  facilityId: number
  bloodGroupId: number
  /** YYYY-MM-DD */
  date: string
  unitsRequested: number
  unitsIssued: number
  unfulfilledUnits: number
}

/** Normalize MySQL DATE / Date / datetime to YYYY-MM-DD (UTC for Date). */
export function toDateOnlyString(
  value: Date | string | null | undefined,
): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())
    return match?.[1] ?? value.trim().slice(0, 10)
  }
  const y = value.getUTCFullYear()
  const m = String(value.getUTCMonth() + 1).padStart(2, '0')
  const d = String(value.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isDemandSyncStatus(status: BloodRequestStatus): boolean {
  return (DEMAND_SYNC_STATUSES as readonly string[]).includes(status)
}

export function demandBucketKey(
  date: string,
  bloodGroupId: number,
  facilityId: number,
): string {
  return `${date}|${bloodGroupId}|${facilityId}`
}

/**
 * Aggregate request rows into one bucket per (date, bloodGroupId, facilityId).
 * Skips non-operational statuses and rows with invalid dates/units.
 */
export function aggregateDemandBuckets(
  requests: DemandRequestInput[] | null | undefined,
): DemandBucket[] {
  const map = new Map<string, DemandBucket>()

  for (const row of requests ?? []) {
    if (!row || !isDemandSyncStatus(row.status)) {
      continue
    }
    if (
      typeof row.facilityId !== 'number' ||
      !Number.isFinite(row.facilityId) ||
      row.facilityId < 1
    ) {
      continue
    }
    if (
      typeof row.bloodGroupId !== 'number' ||
      !Number.isFinite(row.bloodGroupId) ||
      row.bloodGroupId < 1
    ) {
      continue
    }

    const date = toDateOnlyString(row.requestedAt)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue
    }

    const unitsRequested = Math.max(0, Math.trunc(Number(row.unitsRequested) || 0))
    const unitsIssued = Math.max(0, Math.trunc(Number(row.fulfilledUnits) || 0))
    const key = demandBucketKey(date, row.bloodGroupId, row.facilityId)
    const existing = map.get(key)

    if (existing) {
      existing.unitsRequested += unitsRequested
      existing.unitsIssued += unitsIssued
      existing.unfulfilledUnits = Math.max(
        0,
        existing.unitsRequested - existing.unitsIssued,
      )
      continue
    }

    map.set(key, {
      facilityId: row.facilityId,
      bloodGroupId: row.bloodGroupId,
      date,
      unitsRequested,
      unitsIssued,
      unfulfilledUnits: Math.max(0, unitsRequested - unitsIssued),
    })
  }

  return [...map.values()].sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1
    }
    if (a.bloodGroupId !== b.bloodGroupId) {
      return a.bloodGroupId - b.bloodGroupId
    }
    return a.facilityId - b.facilityId
  })
}

/**
 * Collapse facility-level buckets into national (per date + blood group) totals.
 * Used when export history omits facilityId.
 */
export function collapseBucketsByDateAndGroup(
  buckets: DemandBucket[] | null | undefined,
): Array<{ date: string; bloodGroupId: number; demandUnits: number }> {
  const map = new Map<string, { date: string; bloodGroupId: number; demandUnits: number }>()

  for (const bucket of buckets ?? []) {
    if (!bucket?.date || typeof bucket.bloodGroupId !== 'number') {
      continue
    }
    const key = `${bucket.date}|${bucket.bloodGroupId}`
    const units = Math.max(0, bucket.unitsRequested ?? 0)
    const existing = map.get(key)
    if (existing) {
      existing.demandUnits += units
      continue
    }
    map.set(key, {
      date: bucket.date,
      bloodGroupId: bucket.bloodGroupId,
      demandUnits: units,
    })
  }

  return [...map.values()].sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1
    }
    return a.bloodGroupId - b.bloodGroupId
  })
}
