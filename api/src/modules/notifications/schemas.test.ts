/**
 * Notification Zod schema unit tests (no DB / no network).
 */

import { describe, expect, test } from 'bun:test'

import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
  previewNotificationsBodySchema,
  sendNotificationsBodySchema,
} from './schemas'

describe('notificationIdParamSchema', () => {
  test('accepts positive integer ids', () => {
    expect(notificationIdParamSchema.parse({ id: '7' })).toEqual({ id: 7 })
  })

  test('rejects non-positive ids', () => {
    expect(notificationIdParamSchema.safeParse({ id: '0' }).success).toBe(
      false,
    )
  })
})

describe('listNotificationsQuerySchema', () => {
  test('applies pagination defaults', () => {
    const parsed = listNotificationsQuerySchema.parse({
      channel: 'SMS',
      status: 'SENT',
    })
    expect(parsed.channel).toBe('SMS')
    expect(parsed.status).toBe('SENT')
    expect(parsed.limit).toBe(50)
    expect(parsed.offset).toBe(0)
  })

  test('rejects invalid channel', () => {
    expect(
      listNotificationsQuerySchema.safeParse({ channel: 'PUSH' }).success,
    ).toBe(false)
  })
})

describe('previewNotificationsBodySchema / sendNotificationsBodySchema', () => {
  test('requires at least one donorId and a channel', () => {
    expect(
      previewNotificationsBodySchema.safeParse({
        donorIds: [],
        channel: 'SMS',
      }).success,
    ).toBe(false)

    const parsed = sendNotificationsBodySchema.parse({
      donorIds: [1, 2],
      channel: 'EMAIL',
      message: 'Please donate',
      subject: 'NBTS request',
    })
    expect(parsed.donorIds).toEqual([1, 2])
    expect(parsed.channel).toBe('EMAIL')
    expect(parsed.message).toBe('Please donate')
    expect(parsed.subject).toBe('NBTS request')
  })

  test('accepts nullable alertId', () => {
    const parsed = previewNotificationsBodySchema.parse({
      donorIds: [3],
      channel: 'SMS',
      alertId: null,
    })
    expect(parsed.alertId).toBeNull()
  })
})
