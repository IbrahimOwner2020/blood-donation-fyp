export type {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationInput,
  NotificationProvider,
  NotificationResult,
} from './types'

export { redactEmail, redactPhone } from './redact'

export {
  NextSmsProvider,
  type NextSmsConfig,
} from './providers/nextsms-provider'

export {
  MockSmsProvider,
  type MockSmsProviderOptions,
  type MockSmsRecord,
} from './providers/mock-sms-provider'

export {
  SmtpEmailProvider,
  type SmtpEmailConfig,
  type SmtpEmailProviderOptions,
} from './providers/smtp-email-provider'

export {
  createEmailProvider,
  createNotificationProvider,
  createSmsProvider,
  readSmtpConfigFromEnv,
  type NotificationEnv,
  type SmsProviderKind,
} from './create-notification-provider'
