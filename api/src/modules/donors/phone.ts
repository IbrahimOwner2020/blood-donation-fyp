import { AppError } from '../../lib/errors'

/** Store Tanzanian mobile numbers in E.164 form (+255XXXXXXXXX). */
export function normalizeTanzanianPhone(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, '')
  const local = compact.startsWith('+255')
    ? compact.slice(4)
    : compact.startsWith('255')
      ? compact.slice(3)
      : compact.startsWith('0')
        ? compact.slice(1)
        : compact

  if (!/^\d{9}$/.test(local)) {
    throw AppError.validation('Enter a valid Tanzanian phone number', [
      {
        path: 'phone',
        message: 'Use a Tanzanian number such as 0712345678 or +255712345678',
        code: 'invalid_phone',
      },
    ])
  }
  return `+255${local}`
}

export function toNextSmsPhone(value: string): string {
  return normalizeTanzanianPhone(value).slice(1)
}
