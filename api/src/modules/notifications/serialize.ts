/**
 * Public notification DTOs (docs/04 notifications/, docs/06 notifications).
 */

import type {
  NotificationChannel,
  NotificationStatus,
} from '../../db/schema/enums'
import { redactEmail, redactPhone } from '../../services/notifications'

export type PublicDonorSummary = {
  id: number
  donorNumber: string
  firstName: string
  lastName: string
}

export type PublicNotification = {
  id: number
  donorId: number
  donor: PublicDonorSummary | null
  alertId: number | null
  channel: NotificationChannel
  recipient: string
  /** Redacted destination for UI/logs that must avoid full PII. */
  recipientRedacted: string
  message: string
  status: NotificationStatus
  providerMessageId: string | null
  sentAt: Date | null
  createdBy: number
  createdAt: Date
}

export type NotificationRow = {
  id: number
  donorId: number
  alertId: number | null
  channel: NotificationChannel
  recipient: string
  message: string
  status: NotificationStatus
  providerMessageId: string | null
  sentAt: Date | null
  createdBy: number
  createdAt: Date
}

export type DonorJoinRow = {
  id: number
  donorNumber: string
  firstName: string
  lastName: string
}

export type NotificationPreviewItem = {
  donorId: number
  donorNumber: string
  firstName: string
  lastName: string
  channel: NotificationChannel
  recipient: string | null
  recipientRedacted: string | null
  message: string | null
  subject: string | null
  alertId: number | null
  /** Present when this donor cannot be notified on the chosen channel. */
  skipReason: string | null
}

export function redactRecipient(
  channel: NotificationChannel,
  recipient: string | null | undefined,
): string {
  if (channel === 'SMS') {
    return redactPhone(recipient)
  }
  return redactEmail(recipient)
}

export function toPublicDonorSummary(
  row: DonorJoinRow | null | undefined,
): PublicDonorSummary | null {
  if (!row?.id) {
    return null
  }
  return {
    id: row.id,
    donorNumber: row.donorNumber ?? '',
    firstName: row.firstName ?? '',
    lastName: row.lastName ?? '',
  }
}

export function toPublicNotification(
  row: NotificationRow | null | undefined,
  donor: DonorJoinRow | null | undefined = null,
): PublicNotification | null {
  if (!row?.id) {
    return null
  }

  const channel = row.channel ?? 'SMS'
  const recipient = row.recipient ?? ''

  return {
    id: row.id,
    donorId: row.donorId,
    donor: toPublicDonorSummary(donor),
    alertId: row.alertId ?? null,
    channel,
    recipient,
    recipientRedacted: redactRecipient(channel, recipient),
    message: row.message ?? '',
    status: row.status ?? 'PENDING',
    providerMessageId: row.providerMessageId ?? null,
    sentAt: row.sentAt ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}
