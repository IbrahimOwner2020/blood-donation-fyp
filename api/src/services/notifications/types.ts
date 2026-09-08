/**
 * Shared notification provider contracts.
 * Aligns with docs/09-notifications.md — channel delivery only (no HTTP/persistence).
 */

export type NotificationChannel = 'SMS' | 'EMAIL'

/** Provider delivery outcome statuses (PENDING is for persistence layer, not send()). */
export type NotificationDeliveryStatus = 'SENT' | 'FAILED'

export interface NotificationInput {
    /** Delivery channel for this send attempt. */
    channel: NotificationChannel
    /** Destination phone (SMS) or email address (EMAIL). */
    to: string
    /** Message body / SMS text. */
    body: string
    /** Email subject; ignored by SMS providers. */
    subject?: string
    /** Optional correlation / audit hints (no PII required). */
    metadata?: Record<string, string>
}

export interface NotificationResult {
    success: boolean
    status: NotificationDeliveryStatus
    /** Stable provider id, e.g. `mock-sms` or `smtp-email`. */
    provider: string
    /** Provider-assigned id when available. */
    providerMessageId?: string
    /** Safe error message (must not include full phone/email). */
    error?: string
    /** ISO-8601 timestamp when the provider accepted the send. */
    sentAt?: string
}

export interface NotificationProvider {
    readonly id: string
    send(input: NotificationInput): Promise<NotificationResult>
}
