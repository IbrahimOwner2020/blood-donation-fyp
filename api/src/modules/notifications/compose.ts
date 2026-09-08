/**
 * Message composition for donor outreach (docs/09 — preview before send).
 * Pure helpers — no DB, no providers, no auto-send.
 */

import type { NotificationChannel } from '../../db/schema/enums'

export const DEFAULT_EMAIL_SUBJECT = 'NBTS blood donation request'

export type ComposeMessageInput = {
  channel: NotificationChannel
  donorFirstName: string
  bloodGroupCode?: string | null
  alertSeverity?: string | null
  /** When set, used as the message body (still trimmed). */
  customMessage?: string | null
  /** Email subject override; ignored for SMS. */
  customSubject?: string | null
}

export type ComposedMessage = {
  body: string
  subject: string | null
}

function normalizeName(firstName: string | null | undefined): string {
  const trimmed = (firstName ?? '').trim()
  return trimmed.length > 0 ? trimmed : 'Donor'
}

function defaultBody(input: ComposeMessageInput): string {
  const name = normalizeName(input.donorFirstName)
  const group = (input.bloodGroupCode ?? '').trim()
  const severity = (input.alertSeverity ?? '').trim()

  const groupPhrase =
    group.length > 0 ? ` for blood group ${group}` : ''
  const severityPhrase =
    severity.length > 0 ? ` (priority: ${severity})` : ''

  if (input.channel === 'SMS') {
    return (
      `Dear ${name}, NBTS requests your support for blood donation` +
      `${groupPhrase}${severityPhrase}. ` +
      `Please visit your nearest donation centre. Thank you.`
    )
  }

  return (
    `Dear ${name},\n\n` +
    `The National Blood Transfusion Service (NBTS) respectfully requests ` +
    `your support for blood donation${groupPhrase}${severityPhrase}.\n\n` +
    `Please visit your nearest donation centre when you are able. ` +
    `Your contribution helps maintain a safe blood supply.\n\n` +
    `Thank you,\nNBTS`
  )
}

/**
 * Compose body (+ optional email subject) for a single recipient preview/send.
 */
export function composeDonorNotificationMessage(
  input: ComposeMessageInput,
): ComposedMessage {
  const custom = (input.customMessage ?? '').trim()
  const body = custom.length > 0 ? custom : defaultBody(input)

  if (input.channel === 'EMAIL') {
    const customSubject = (input.customSubject ?? '').trim()
    return {
      body,
      subject:
        customSubject.length > 0 ? customSubject : DEFAULT_EMAIL_SUBJECT,
    }
  }

  return { body, subject: null }
}

/**
 * Resolve destination for a channel from donor contact fields.
 * Returns null when the donor cannot receive on that channel.
 */
export function resolveRecipientForChannel(
  channel: NotificationChannel,
  contacts: { phone?: string | null; email?: string | null },
): string | null {
  if (channel === 'SMS') {
    const phone = (contacts?.phone ?? '').trim()
    return phone.length > 0 ? phone : null
  }

  if (channel === 'EMAIL') {
    const email = (contacts?.email ?? '').trim()
    return email.length > 0 ? email : null
  }

  const _exhaustive: never = channel
  return _exhaustive
}
