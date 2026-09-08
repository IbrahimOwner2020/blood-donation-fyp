/**
 * Pure inventory supply / expiry helpers (docs/08 supply formula, TODO.md §4).
 *
 * expected_available_supply =
 *   count of units with status AVAILABLE and expiry_date >= asOf (not past expiry)
 *
 * Status EXPIRED alone is not enough — calendar expiry must also exclude
 * AVAILABLE rows that have passed their shelf life from available counts.
 */

import type { InventoryStatus } from '../../db/schema/enums'

export type InventoryUnitSnapshot = {
  bloodGroupId: number
  bloodGroupCode?: string
  status: InventoryStatus
  /** Calendar date YYYY-MM-DD */
  expiryDate: string
}

export type BloodGroupInventoryCounts = {
  bloodGroupId: number
  bloodGroupCode: string | null
  /** AVAILABLE and expiryDate >= asOf */
  availableUnits: number
  reservedUnits: number
  issuedUnits: number
  discardedUnits: number
  /**
   * Explicit EXPIRED status, or AVAILABLE/RESERVED past calendar expiry
   * (still on books but not usable supply).
   */
  expiredUnits: number
  /** AVAILABLE (and not past expiry) with expiry within the window. */
  expiringSoonUnits: number
  lowStock: boolean
}

export type SummarizeOptions = {
  /** YYYY-MM-DD reference date (typically "today" UTC). */
  asOf: string
  /** Inclusive window length for expiring-soon (default from caller). */
  expiringWithinDays: number
  /** availableUnits <= threshold → lowStock. */
  lowStockThreshold: number
  /** Optional id → code map for summary rows. */
  bloodGroupCodes?: ReadonlyMap<number, string>
}

/** Normalize to YYYY-MM-DD for string compare (ISO dates sort lexicographically). */
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

/** UTC calendar "today" as YYYY-MM-DD. */
export function utcTodayDateOnly(now: Date = new Date()): string {
  return toDateOnlyString(now)
}

/** Add calendar days to a YYYY-MM-DD date (UTC). */
export function addUtcDays(dateOnly: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly.trim())
  if (!match) {
    throw new Error(`Invalid date: ${dateOnly}`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  utc.setUTCDate(utc.getUTCDate() + days)
  return toDateOnlyString(utc)
}

/**
 * Past shelf life relative to asOf (expiryDate < asOf).
 * Expiry on asOf is still usable that day.
 */
export function isPastExpiry(
  expiryDate: string,
  asOf: string,
): boolean {
  const expiry = toDateOnlyString(expiryDate)
  const ref = toDateOnlyString(asOf)
  if (!expiry || !ref) {
    return true
  }
  return expiry < ref
}

/**
 * Docs/08: AVAILABLE and not expired → counts toward expected available supply.
 */
export function isEffectivelyAvailable(
  unit: Pick<InventoryUnitSnapshot, 'status' | 'expiryDate'>,
  asOf: string,
): boolean {
  if (unit?.status !== 'AVAILABLE') {
    return false
  }
  return !isPastExpiry(unit.expiryDate, asOf)
}

/**
 * Expiring soon: effectively available and expiryDate <= asOf + withinDays.
 * Inclusive of asOf (expires today) through the window end.
 */
export function isExpiringSoon(
  unit: Pick<InventoryUnitSnapshot, 'status' | 'expiryDate'>,
  asOf: string,
  withinDays: number,
): boolean {
  if (!isEffectivelyAvailable(unit, asOf)) {
    return false
  }
  const windowEnd = addUtcDays(toDateOnlyString(asOf), withinDays)
  const expiry = toDateOnlyString(unit.expiryDate)
  return expiry <= windowEnd
}

/**
 * Classify a unit into summary buckets (mutually exclusive for stock columns
 * except expiringSoon which is a subset of available).
 */
export function classifyUnit(
  unit: Pick<InventoryUnitSnapshot, 'status' | 'expiryDate'>,
  asOf: string,
): {
  available: boolean
  reserved: boolean
  issued: boolean
  discarded: boolean
  expired: boolean
} {
  const past = isPastExpiry(unit.expiryDate, asOf)
  const status = unit?.status

  if (status === 'ISSUED') {
    return {
      available: false,
      reserved: false,
      issued: true,
      discarded: false,
      expired: false,
    }
  }
  if (status === 'DISCARDED') {
    return {
      available: false,
      reserved: false,
      issued: false,
      discarded: true,
      expired: false,
    }
  }
  if (status === 'EXPIRED' || (past && (status === 'AVAILABLE' || status === 'RESERVED'))) {
    return {
      available: false,
      reserved: false,
      issued: false,
      discarded: false,
      expired: true,
    }
  }
  if (status === 'RESERVED') {
    return {
      available: false,
      reserved: true,
      issued: false,
      discarded: false,
      expired: false,
    }
  }
  if (status === 'AVAILABLE') {
    return {
      available: true,
      reserved: false,
      issued: false,
      discarded: false,
      expired: false,
    }
  }
  return {
    available: false,
    reserved: false,
    issued: false,
    discarded: false,
    expired: false,
  }
}

function emptyCounts(
  bloodGroupId: number,
  bloodGroupCode: string | null,
): BloodGroupInventoryCounts {
  return {
    bloodGroupId,
    bloodGroupCode,
    availableUnits: 0,
    reservedUnits: 0,
    issuedUnits: 0,
    discardedUnits: 0,
    expiredUnits: 0,
    expiringSoonUnits: 0,
    lowStock: false,
  }
}

/**
 * Aggregate unit snapshots into per–blood-group summary rows.
 * Available counts never include past-expiry units (docs/08).
 */
export function summarizeByBloodGroup(
  units: readonly InventoryUnitSnapshot[] | null | undefined,
  options: SummarizeOptions,
): BloodGroupInventoryCounts[] {
  const asOf = toDateOnlyString(options.asOf)
  const withinDays = options.expiringWithinDays
  const threshold = options.lowStockThreshold
  const codeMap = options.bloodGroupCodes

  const byGroup = new Map<number, BloodGroupInventoryCounts>()

  for (const unit of units ?? []) {
    if (typeof unit?.bloodGroupId !== 'number' || !Number.isFinite(unit.bloodGroupId)) {
      continue
    }

    let row = byGroup.get(unit.bloodGroupId)
    if (!row) {
      const code =
        unit.bloodGroupCode ??
        codeMap?.get(unit.bloodGroupId) ??
        null
      row = emptyCounts(unit.bloodGroupId, code)
      byGroup.set(unit.bloodGroupId, row)
    }

    const bucket = classifyUnit(unit, asOf)
    if (bucket.available) {
      row.availableUnits += 1
      if (isExpiringSoon(unit, asOf, withinDays)) {
        row.expiringSoonUnits += 1
      }
    } else if (bucket.reserved) {
      row.reservedUnits += 1
    } else if (bucket.issued) {
      row.issuedUnits += 1
    } else if (bucket.discarded) {
      row.discardedUnits += 1
    } else if (bucket.expired) {
      row.expiredUnits += 1
    }
  }

  const rows = Array.from(byGroup.values())
  for (const row of rows) {
    row.lowStock = row.availableUnits <= threshold
  }

  rows.sort((a, b) => a.bloodGroupId - b.bloodGroupId)
  return rows
}

/** Filter summary rows that are at or below the low-stock threshold. */
export function filterLowStock(
  summaries: readonly BloodGroupInventoryCounts[] | null | undefined,
  threshold: number = Number.POSITIVE_INFINITY,
): BloodGroupInventoryCounts[] {
  return (summaries ?? []).filter(
    (row) =>
      typeof row?.availableUnits === 'number' &&
      row.availableUnits <= threshold,
  )
}

/**
 * Filter units that are effectively available and expire within the window.
 */
export function filterExpiringUnits(
  units: readonly InventoryUnitSnapshot[] | null | undefined,
  asOf: string,
  withinDays: number,
): InventoryUnitSnapshot[] {
  return (units ?? []).filter((unit) =>
    isExpiringSoon(unit, asOf, withinDays),
  )
}
