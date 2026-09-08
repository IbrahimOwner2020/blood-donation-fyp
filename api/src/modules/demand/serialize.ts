/**
 * Public demand-record DTOs + AI contract mappers (docs/14 HistoryPoint / series).
 */

import type { DemandSource } from '../../db/schema/enums'
import type {
  BloodGroup,
  HistoryPoint,
  TrainingSeriesPoint,
} from '../../services/ai/types'
import { toDateOnlyString } from './aggregate'

export { toDateOnlyString }

export type PublicBloodGroupSummary = {
  id: number
  code: string
  abo: string
  rh: string
}

export type PublicDemandRecord = {
  id: number
  facilityId: number | null
  bloodGroupId: number
  bloodGroup: PublicBloodGroupSummary | null
  date: string
  unitsRequested: number
  unitsIssued: number
  unitsUsed: number | null
  unfulfilledUnits: number | null
  source: DemandSource
  createdAt: Date
  /** AI target: requested demand for the day (docs/14 demand_units). */
  demandUnits: number
}

export type DemandRecordRow = {
  id: number
  facilityId: number | null
  bloodGroupId: number
  date: Date | string
  unitsRequested: number
  unitsIssued: number
  unitsUsed: number | null
  unfulfilledUnits: number | null
  source: DemandSource
  createdAt: Date
}

export type BloodGroupJoinRow = {
  id: number
  code: string
  abo: string
  rh: string
}

export function toPublicBloodGroupSummary(
  row: BloodGroupJoinRow | null | undefined,
): PublicBloodGroupSummary | null {
  if (!row?.id || !row?.code) {
    return null
  }
  return {
    id: row.id,
    code: row.code,
    abo: row.abo ?? '',
    rh: row.rh ?? '',
  }
}

export function toPublicDemandRecord(
  row: DemandRecordRow | null | undefined,
  bloodGroup: BloodGroupJoinRow | null | undefined = null,
): PublicDemandRecord | null {
  if (!row?.id) {
    return null
  }

  const unitsRequested = row.unitsRequested ?? 0

  return {
    id: row.id,
    facilityId: row.facilityId ?? null,
    bloodGroupId: row.bloodGroupId,
    bloodGroup: toPublicBloodGroupSummary(bloodGroup),
    date: toDateOnlyString(row.date),
    unitsRequested,
    unitsIssued: row.unitsIssued ?? 0,
    unitsUsed: row.unitsUsed ?? null,
    unfulfilledUnits: row.unfulfilledUnits ?? null,
    source: row.source ?? 'SYSTEM',
    createdAt: row.createdAt,
    demandUnits: unitsRequested,
  }
}

/**
 * ForecastRequest.history shape — one blood group, optional facility.
 * `demand_units` = units_requested for that day (summed if multi-facility collapse).
 */
export function toAiHistoryPoints(
  records: PublicDemandRecord[] | null | undefined,
): HistoryPoint[] {
  const byDate = new Map<string, number>()

  for (const record of records ?? []) {
    const date = record?.date
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue
    }
    const units = Math.max(0, Number(record.demandUnits) || 0)
    byDate.set(date, (byDate.get(date) ?? 0) + units)
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, demand_units]) => ({ date, demand_units }))
}

/**
 * TrainRequest.series shape — may span blood groups / facilities.
 */
export function toAiTrainingSeries(
  records: PublicDemandRecord[] | null | undefined,
): TrainingSeriesPoint[] {
  const points: TrainingSeriesPoint[] = []

  for (const record of records ?? []) {
    const code = record?.bloodGroup?.code
    const date = record?.date
    if (!code || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue
    }

    points.push({
      blood_group: code as BloodGroup,
      facility_id:
        typeof record.facilityId === 'number'
          ? String(record.facilityId)
          : null,
      date,
      demand_units: Math.max(0, Number(record.demandUnits) || 0),
    })
  }

  return points.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1
    }
    if (a.blood_group !== b.blood_group) {
      return a.blood_group < b.blood_group ? -1 : 1
    }
    const fa = a.facility_id ?? ''
    const fb = b.facility_id ?? ''
    return fa < fb ? -1 : fa > fb ? 1 : 0
  })
}
