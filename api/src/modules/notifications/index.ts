/**
 * Notifications module public surface (docs/04 notifications/, docs/09, TODO.md §8).
 */

export {
  notificationRoutes,
  NotificationAuditActions,
  type NotificationAuditAction,
} from './routes'
export {
  notificationChannelSchema,
  notificationStatusSchema,
  notificationIdParamSchema,
  listNotificationsQuerySchema,
  notificationComposeBodySchema,
  previewNotificationsBodySchema,
  sendNotificationsBodySchema,
  type NotificationIdParam,
  type ListNotificationsQuery,
  type NotificationComposeBody,
  type PreviewNotificationsBody,
  type SendNotificationsBody,
} from './schemas'
export {
  composeDonorNotificationMessage,
  resolveRecipientForChannel,
  DEFAULT_EMAIL_SUBJECT,
  type ComposeMessageInput,
  type ComposedMessage,
} from './compose'
export {
  toPublicNotification,
  toPublicDonorSummary,
  redactRecipient,
  type PublicNotification,
  type PublicDonorSummary,
  type NotificationRow,
  type DonorJoinRow,
  type NotificationPreviewItem,
} from './serialize'
export {
  listNotifications,
  getNotificationById,
  previewNotifications,
  sendNotifications,
  type ListNotificationsResult,
  type PreviewNotificationsResult,
  type SendNotificationsResult,
  type SendNotificationItemResult,
  type NotificationServiceDeps,
} from './service'
