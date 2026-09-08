import type { NotificationChannel, NotificationProvider } from './types'
import { MockSmsProvider } from './providers/mock-sms-provider'
import {
  SmtpEmailProvider,
  type SmtpEmailConfig,
} from './providers/smtp-email-provider'

export type SmsProviderKind = 'mock'

export interface NotificationEnv {
  SMS_PROVIDER?: string
  SMTP_HOST?: string
  SMTP_PORT?: string
  SMTP_FROM?: string
  SMTP_USER?: string
  SMTP_PASS?: string
  SMTP_SECURE?: string
}

/**
 * Reads SMTP settings from env with Mailpit-friendly defaults
 * (docs/15-environment-and-configuration.md).
 */
export function readSmtpConfigFromEnv(
  env: NotificationEnv = Bun.env,
): SmtpEmailConfig {
  const host = (env.SMTP_HOST ?? 'localhost').trim() || 'localhost'
  const portRaw = env.SMTP_PORT ?? '1025'
  const port = Number(portRaw)
  const from =
    (env.SMTP_FROM ?? 'no-reply@nbts.local').trim() || 'no-reply@nbts.local'
  const user = env.SMTP_USER?.trim() || undefined
  const pass = env.SMTP_PASS?.trim() || undefined
  const secureRaw = (env.SMTP_SECURE ?? 'false').trim().toLowerCase()
  const secure = secureRaw === 'true' || secureRaw === '1'

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid SMTP_PORT: ${portRaw}`)
  }

  return {
    host,
    port,
    from,
    user,
    pass,
    secure,
  }
}

/**
 * Selects the SMS provider from SMS_PROVIDER (default: mock).
 */
export function createSmsProvider(
  env: NotificationEnv = Bun.env,
): NotificationProvider {
  const kind = (env.SMS_PROVIDER ?? 'mock').trim().toLowerCase() || 'mock'

  if (kind === 'mock') {
    return new MockSmsProvider()
  }

  throw new Error(
    `Unsupported SMS_PROVIDER="${kind}". Supported: mock`,
  )
}

/**
 * Creates the SMTP email provider from env (Mailpit-compatible).
 */
export function createEmailProvider(
  env: NotificationEnv = Bun.env,
): NotificationProvider {
  return new SmtpEmailProvider({
    config: readSmtpConfigFromEnv(env),
  })
}

/**
 * Factory/selector: returns the provider for a given channel based on env.
 */
export function createNotificationProvider(
  channel: NotificationChannel,
  env: NotificationEnv = Bun.env,
): NotificationProvider {
  if (channel === 'SMS') {
    return createSmsProvider(env)
  }

  if (channel === 'EMAIL') {
    return createEmailProvider(env)
  }

  // Exhaustiveness guard for future channels.
  const _exhaustive: never = channel
  throw new Error(`Unsupported notification channel: ${String(_exhaustive)}`)
}
