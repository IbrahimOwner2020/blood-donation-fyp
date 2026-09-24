/**
 * Privacy tests — preview/history DTOs expose redacted destinations;
 * audit-shaped metadata must not carry raw phone/email (docs/09 Privacy).
 */

import { describe, expect, test } from 'bun:test'

import { redactSensitive } from '../../lib/logger'
import { redactActivityMetadata } from '../../services/audit'
import {
  redactRecipient,
  toPublicNotification,
  type NotificationRow,
} from './serialize'

describe('redactRecipient', () => {
  test('redacts SMS phone keeping last four digits', () => {
    expect(redactRecipient('SMS', '+255712345678')).toBe('***5678')
  })

  test('redacts EMAIL local part', () => {
    expect(redactRecipient('EMAIL', 'donor@example.com')).toBe(
      'd***@example.com',
    )
  })
})

describe('toPublicNotification privacy fields', () => {
  test('includes recipientRedacted alongside full recipient for authorized UI', () => {
    const row: NotificationRow = {
      id: 1,
      donorId: 10,
      alertId: 5,
      channel: 'SMS',
      recipient: '+255712345678',
      message: 'Please donate',
      status: 'SENT',
      providerMessageId: 'mock-1',
      deduplicationKey: null,
      deliveryError: null,
      sentAt: new Date('2026-01-01T00:00:00.000Z'),
      createdBy: 2,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    const publicRow = toPublicNotification(row, {
      id: 10,
      donorNumber: 'DN-001',
      firstName: 'Amina',
      lastName: 'Juma',
    })

    expect(publicRow?.recipient).toBe('+255712345678')
    expect(publicRow?.recipientRedacted).toBe('***5678')
    expect(publicRow?.donor?.donorNumber).toBe('DN-001')
  })
})

describe('audit / log metadata must not leak raw destinations', () => {
  test('redactSensitive masks recipient and to keys', () => {
    const redacted = redactSensitive({
      recipient: '+255712345678',
      to: 'donor@example.com',
      donorId: 10,
      channel: 'SMS',
    }) as Record<string, unknown>

    expect(redacted.recipient).toBe('[REDACTED]')
    expect(redacted.to).toBe('[REDACTED]')
    expect(redacted.donorId).toBe(10)
    expect(redacted.channel).toBe('SMS')
  })

  test('activity metadata keeps redacted summary, not raw phone', () => {
    const meta = redactActivityMetadata({
      channel: 'SMS',
      recipientsRedacted: '***5678',
      sentCount: 1,
      // If a caller accidentally included raw recipient, logger redaction strips it.
      recipient: '+255712345678',
    })

    expect(meta?.recipientsRedacted).toBe('***5678')
    expect(meta?.recipient).toBe('[REDACTED]')
    expect(meta?.sentCount).toBe(1)
    expect(JSON.stringify(meta)).not.toContain('+255712345678')
  })
})
