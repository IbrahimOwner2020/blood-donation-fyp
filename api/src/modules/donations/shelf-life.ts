/**
 * Whole-blood unit shelf life for prototype inventory expiry (docs/06).
 * Typical whole-blood storage window used for NBTS-style prototypes.
 */
export const BLOOD_UNIT_SHELF_LIFE_DAYS = 35

/**
 * Compute expiry as collection date + shelf-life days (calendar date, UTC).
 * Accepts `YYYY-MM-DD` or a Date; returns `YYYY-MM-DD`.
 */
export function computeExpiryDate(
  collectionDate: string | Date,
  shelfLifeDays: number = BLOOD_UNIT_SHELF_LIFE_DAYS,
): string {
  const dateOnly =
    typeof collectionDate === 'string'
      ? collectionDate.trim().slice(0, 10)
      : toUtcDateOnly(collectionDate)

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly)
  if (!match) {
    throw new Error(`Invalid collection date: ${dateOnly}`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  utc.setUTCDate(utc.getUTCDate() + shelfLifeDays)
  return toUtcDateOnly(utc)
}

function toUtcDateOnly(value: Date): string {
  const y = value.getUTCFullYear()
  const m = String(value.getUTCMonth() + 1).padStart(2, '0')
  const d = String(value.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
