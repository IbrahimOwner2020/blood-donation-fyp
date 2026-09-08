/**
 * Public report DTO helpers (docs/04 Reports, TODO.md §9).
 */

export type PublicBloodGroupSummary = {
  id: number
  code: string
  abo: string
  rh: string
}

export type BloodGroupJoinRow = {
  id: number
  code: string
  abo: string
  rh: string
}

export function toPublicBloodGroup(
  group: BloodGroupJoinRow | null | undefined,
): PublicBloodGroupSummary | null {
  if (!group?.id || !group?.code) {
    return null
  }
  return {
    id: group.id,
    code: group.code,
    abo: group.abo ?? '',
    rh: group.rh ?? '',
  }
}

export function toDateOnlyString(
  value: Date | string | null | undefined,
): string {
  if (value == null) {
    return ''
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10)
    }
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) {
      return ''
    }
    const y = parsed.getUTCFullYear()
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0')
    const d = String(parsed.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return ''
  }
  const y = value.getUTCFullYear()
  const m = String(value.getUTCMonth() + 1).padStart(2, '0')
  const d = String(value.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}
