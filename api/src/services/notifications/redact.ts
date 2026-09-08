/**
 * Privacy helpers — never log full donor phone numbers or emails.
 * See docs/09-notifications.md Privacy section.
 */

/**
 * Redacts a phone number for logs, keeping only the last 4 digits when possible.
 * @example redactPhone('+255712345678') => '***5678'
 */
export function redactPhone(phone: string | null | undefined): string {
  const raw = (phone ?? '').trim()
  if (!raw) {
    return '***'
  }

  const digits = raw.replace(/\D/g, '')
  if (digits.length < 4) {
    return '***'
  }

  return `***${digits.slice(-4)}`
}

/**
 * Redacts an email for logs: first character of local part + domain.
 * @example redactEmail('donor@example.com') => 'd***@example.com'
 */
export function redactEmail(email: string | null | undefined): string {
  const raw = (email ?? '').trim()
  if (!raw) {
    return '***'
  }

  const atIndex = raw.lastIndexOf('@')
  if (atIndex <= 0 || atIndex === raw.length - 1) {
    return '***'
  }

  const local = raw.slice(0, atIndex)
  const domain = raw.slice(atIndex + 1)
  const visible = local.charAt(0) || '*'

  return `${visible}***@${domain}`
}
