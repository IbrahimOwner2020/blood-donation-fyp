/**
 * Zod schemas for notification routes (docs/04 notifications/, docs/09, TODO.md §8).
 */

import { z } from 'zod'

import {
  notificationChannels,
  notificationStatuses,
} from '../../db/schema/enums'

export const notificationChannelSchema = z.enum(notificationChannels)
export const notificationStatusSchema = z.enum(notificationStatuses)

export const notificationIdParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'Notification id must be a number' })
    .int('Notification id must be an integer')
    .positive('Notification id must be positive'),
})

export type NotificationIdParam = z.infer<typeof notificationIdParamSchema>

export const listNotificationsQuerySchema = z.object({
  donorId: z.coerce
    .number({ invalid_type_error: 'donorId must be a number' })
    .int('donorId must be an integer')
    .positive('donorId must be positive')
    .optional(),
  alertId: z.coerce
    .number({ invalid_type_error: 'alertId must be a number' })
    .int('alertId must be an integer')
    .positive('alertId must be positive')
    .optional(),
  channel: notificationChannelSchema.optional(),
  status: notificationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>

const donorIdsSchema = z
  .array(
    z
      .number({ invalid_type_error: 'donorIds entries must be numbers' })
      .int('donorIds entries must be integers')
      .positive('donorIds entries must be positive'),
  )
  .min(1, 'At least one donorId is required')
  .max(100, 'At most 100 donorIds allowed')

/**
 * Shared body for preview + send: selected donors, channel, optional alert + copy.
 * Preview never sends; send requires notifications:send (docs/09 workflow).
 */
export const notificationComposeBodySchema = z.object({
  donorIds: donorIdsSchema,
  channel: notificationChannelSchema,
  alertId: z
    .number({ invalid_type_error: 'alertId must be a number' })
    .int('alertId must be an integer')
    .positive('alertId must be positive')
    .nullable()
    .optional(),
  /** Optional override; when omitted the API composes a default message. */
  message: z
    .string()
    .trim()
    .min(1, 'message must not be empty')
    .max(2000, 'message must be at most 2000 characters')
    .optional(),
  /** Email subject; ignored for SMS. */
  subject: z
    .string()
    .trim()
    .min(1, 'subject must not be empty')
    .max(200, 'subject must be at most 200 characters')
    .optional(),
})

export type NotificationComposeBody = z.infer<
  typeof notificationComposeBodySchema
>

export const previewNotificationsBodySchema = notificationComposeBodySchema
export type PreviewNotificationsBody = NotificationComposeBody

export const sendNotificationsBodySchema = notificationComposeBodySchema
export type SendNotificationsBody = NotificationComposeBody
