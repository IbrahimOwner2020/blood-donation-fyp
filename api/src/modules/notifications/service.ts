/**
 * Notification persistence + preview/send orchestration (docs/09, TODO.md §8).
 *
 * Preview composes messages without sending or writing rows.
 * Send uses providers, persists PENDING → SENT|FAILED, never auto-fires from matching.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  max,
  type SQL,
} from 'drizzle-orm'

import type { Db } from '../../db'
import {
  bloodGroups,
  donations,
  donors,
  notifications,
  roles,
  shortageAlerts,
  userRoles,
  users,
} from '../../db/schema'
import type {
  NotificationChannel,
  NotificationStatus,
} from '../../db/schema/enums'
import { AppError } from '../../lib/errors'
import { logInfo, logWarn } from '../../lib/logger'
import {
  createNotificationProvider,
  type NotificationProvider,
} from '../../services/notifications'
import {
  composeDonorNotificationMessage,
  resolveRecipientForChannel,
} from './compose'
import type {
  ListNotificationsQuery,
  NotificationComposeBody,
} from './schemas'
import {
  redactRecipient,
  toPublicNotification,
  type DonorJoinRow,
  type NotificationPreviewItem,
  type NotificationRow,
  type PublicNotification,
} from './serialize'
import { calculateDonorEligibility } from '../donors/eligibility'

type LoadedNotification = {
  notification: NotificationRow
  donor: DonorJoinRow | null
}

type DonorWithGroup = {
  id: number
  donorNumber: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  smsConsent: boolean
  emailConsent: boolean
  active: boolean
  bloodGroupCode: string | null
}

export type NotificationServiceDeps = {
  /**
   * Injectable provider factory (tests). Default: createNotificationProvider(channel).
   */
  getProvider?: (channel: NotificationChannel) => NotificationProvider
  now?: () => Date
}

function mapNotificationRow(
  row: typeof notifications.$inferSelect,
): NotificationRow {
  return {
    id: row.id,
    donorId: row.donorId,
    alertId: row.alertId ?? null,
    channel: row.channel,
    recipient: row.recipient,
    message: row.message,
    status: row.status,
    providerMessageId: row.providerMessageId ?? null,
    deduplicationKey: row.deduplicationKey ?? null,
    deliveryError: row.deliveryError ?? null,
    sentAt: row.sentAt ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

function mapDonorJoin(
  row: typeof donors.$inferSelect | null | undefined,
): DonorJoinRow | null {
  if (!row?.id) {
    return null
  }
  return {
    id: row.id,
    donorNumber: row.donorNumber,
    firstName: row.firstName,
    lastName: row.lastName,
  }
}

async function loadNotification(
  db: Db,
  id: number,
): Promise<LoadedNotification | null> {
  const rows = await db
    .select({
      notification: notifications,
      donor: donors,
    })
    .from(notifications)
    .leftJoin(donors, eq(notifications.donorId, donors.id))
    .where(eq(notifications.id, id))
    .limit(1)

  const match = rows?.[0]
  if (!match?.notification?.id) {
    return null
  }

  return {
    notification: mapNotificationRow(match.notification),
    donor: mapDonorJoin(match.donor),
  }
}

function buildListConditions(filters: ListNotificationsQuery): SQL | undefined {
  const parts: SQL[] = []

  if (typeof filters.donorId === 'number') {
    parts.push(eq(notifications.donorId, filters.donorId))
  }
  if (typeof filters.alertId === 'number') {
    parts.push(eq(notifications.alertId, filters.alertId))
  }
  if (filters.channel) {
    parts.push(eq(notifications.channel, filters.channel))
  }
  if (filters.status) {
    parts.push(eq(notifications.status, filters.status))
  }

  if (parts.length === 0) {
    return undefined
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return and(...parts)
}

export type ListNotificationsResult = {
  items: PublicNotification[]
  total: number
  limit: number
  offset: number
}

export async function listNotifications(
  db: Db,
  query: ListNotificationsQuery,
): Promise<ListNotificationsResult> {
  const limit = query.limit ?? 50
  const offset = query.offset ?? 0
  const whereClause = buildListConditions(query)

  const [totalRow] = await db
    .select({ value: count() })
    .from(notifications)
    .where(whereClause)

  const total = Number(totalRow?.value ?? 0)

  const rows = await db
    .select({
      notification: notifications,
      donor: donors,
    })
    .from(notifications)
    .leftJoin(donors, eq(notifications.donorId, donors.id))
    .where(whereClause)
    .orderBy(desc(notifications.createdAt), asc(notifications.id))
    .limit(limit)
    .offset(offset)

  const items = (rows ?? [])
    .map((row) =>
      toPublicNotification(
        row?.notification ? mapNotificationRow(row.notification) : null,
        mapDonorJoin(row?.donor),
      ),
    )
    .filter((item): item is PublicNotification => item !== null)

  return { items, total, limit, offset }
}

export async function getNotificationById(
  db: Db,
  id: number,
): Promise<PublicNotification> {
  const loaded = await loadNotification(db, id)
  if (!loaded) {
    throw AppError.notFound('Notification not found')
  }
  const publicRow = toPublicNotification(loaded.notification, loaded.donor)
  if (!publicRow) {
    throw AppError.notFound('Notification not found')
  }
  return publicRow
}

async function requireAlertExists(
  db: Db,
  alertId: number | null | undefined,
): Promise<{ id: number; severity: string; bloodGroupCode: string | null } | null> {
  if (alertId === null || alertId === undefined) {
    return null
  }

  const rows = await db
    .select({
      alert: shortageAlerts,
      bloodGroup: bloodGroups,
    })
    .from(shortageAlerts)
    .leftJoin(bloodGroups, eq(shortageAlerts.bloodGroupId, bloodGroups.id))
    .where(eq(shortageAlerts.id, alertId))
    .limit(1)

  const match = rows?.[0]
  if (!match?.alert?.id) {
    throw AppError.notFound('Shortage alert not found')
  }

  return {
    id: match.alert.id,
    severity: match.alert.severity,
    bloodGroupCode: match.bloodGroup?.code ?? null,
  }
}

async function loadDonorsForCompose(
  db: Db,
  donorIds: number[],
): Promise<Map<number, DonorWithGroup>> {
  const uniqueIds = [...new Set(donorIds)]
  const rows = await db
    .select({
      donor: donors,
      bloodGroup: bloodGroups,
    })
    .from(donors)
    .leftJoin(bloodGroups, eq(donors.bloodGroupId, bloodGroups.id))
    .where(inArray(donors.id, uniqueIds))

  const map = new Map<number, DonorWithGroup>()
  for (const row of rows ?? []) {
    const d = row?.donor
    if (!d?.id) {
      continue
    }
    map.set(d.id, {
      id: d.id,
      donorNumber: d.donorNumber ?? '',
      firstName: d.firstName ?? '',
      lastName: d.lastName ?? '',
      phone: d.phone ?? null,
      email: d.email ?? null,
      smsConsent: d.smsConsent ?? false,
      emailConsent: d.emailConsent ?? false,
      active: d.active ?? false,
      bloodGroupCode: row?.bloodGroup?.code ?? null,
    })
  }
  return map
}

function buildPreviewItem(
  donorId: number,
  channel: NotificationChannel,
  alertId: number | null,
  body: NotificationComposeBody,
  donorMap: Map<number, DonorWithGroup>,
  alertSeverity: string | null,
  alertBloodGroupCode: string | null,
): NotificationPreviewItem {
  const donor = donorMap.get(donorId)
  if (!donor) {
    return {
      donorId,
      donorNumber: '',
      firstName: '',
      lastName: '',
      channel,
      recipient: null,
      recipientRedacted: null,
      message: null,
      subject: null,
      alertId,
      skipReason: 'Donor not found',
    }
  }

  if (!donor.active) {
    return {
      donorId: donor.id,
      donorNumber: donor.donorNumber,
      firstName: donor.firstName,
      lastName: donor.lastName,
      channel,
      recipient: null,
      recipientRedacted: null,
      message: null,
      subject: null,
      alertId,
      skipReason: 'Donor is inactive',
    }
  }

  if ((channel === 'SMS' && !donor.smsConsent) || (channel === 'EMAIL' && !donor.emailConsent)) {
    return {
      donorId: donor.id,
      donorNumber: donor.donorNumber,
      firstName: donor.firstName,
      lastName: donor.lastName,
      channel,
      recipient: null,
      recipientRedacted: null,
      message: null,
      subject: null,
      alertId,
      skipReason: `Donor has not consented to ${channel} notifications`,
    }
  }

  const recipient = resolveRecipientForChannel(channel, {
    phone: donor.phone,
    email: donor.email,
  })

  if (!recipient) {
    return {
      donorId: donor.id,
      donorNumber: donor.donorNumber,
      firstName: donor.firstName,
      lastName: donor.lastName,
      channel,
      recipient: null,
      recipientRedacted: null,
      message: null,
      subject: null,
      alertId,
      skipReason:
        channel === 'SMS'
          ? 'Donor has no phone number for SMS'
          : 'Donor has no email for EMAIL',
    }
  }

  const composed = composeDonorNotificationMessage({
    channel,
    donorFirstName: donor.firstName,
    bloodGroupCode: alertBloodGroupCode ?? donor.bloodGroupCode,
    alertSeverity,
    customMessage: body.message,
    customSubject: body.subject,
  })

  return {
    donorId: donor.id,
    donorNumber: donor.donorNumber,
    firstName: donor.firstName,
    lastName: donor.lastName,
    channel,
    recipient,
    recipientRedacted: redactRecipient(channel, recipient),
    message: composed.body,
    subject: composed.subject,
    alertId,
    skipReason: null,
  }
}

export type PreviewNotificationsResult = {
  channel: NotificationChannel
  alertId: number | null
  previews: NotificationPreviewItem[]
  composedCount: number
  skippedCount: number
}

/**
 * Compose messages for selected donors without sending or persisting.
 */
export async function previewNotifications(
  db: Db,
  body: NotificationComposeBody,
): Promise<PreviewNotificationsResult> {
  const alertId = body.alertId ?? null
  const alert = await requireAlertExists(db, alertId)
  const donorMap = await loadDonorsForCompose(db, body.donorIds)

  const previews = body.donorIds.map((donorId) =>
    buildPreviewItem(
      donorId,
      body.channel,
      alertId,
      body,
      donorMap,
      alert?.severity ?? null,
      alert?.bloodGroupCode ?? null,
    ),
  )

  const composedCount = previews.filter((p) => p.skipReason === null).length
  const skippedCount = previews.length - composedCount

  return {
    channel: body.channel,
    alertId,
    previews,
    composedCount,
    skippedCount,
  }
}

export type SendNotificationItemResult = {
  donorId: number
  notification: PublicNotification | null
  status: NotificationStatus | 'SKIPPED'
  skipReason: string | null
  error: string | null
  recipientRedacted: string | null
}

export type SendNotificationsResult = {
  channel: NotificationChannel
  alertId: number | null
  results: SendNotificationItemResult[]
  sentCount: number
  failedCount: number
  skippedCount: number
}

/**
 * Preview → provider send → persist SENT/FAILED for each eligible donor.
 */
export async function sendNotifications(
  db: Db,
  body: NotificationComposeBody,
  createdByUserId: number,
  deps: NotificationServiceDeps = {},
): Promise<SendNotificationsResult> {
  if (
    typeof createdByUserId !== 'number' ||
    !Number.isFinite(createdByUserId) ||
    createdByUserId < 1
  ) {
    throw AppError.unauthorized('Authenticated user required')
  }

  const preview = await previewNotifications(db, body)
  const getProvider =
    deps.getProvider ??
    ((channel: NotificationChannel) => createNotificationProvider(channel))
  const now = deps.now ?? (() => new Date())

  const provider = getProvider(body.channel)
  const results: SendNotificationItemResult[] = []
  let sentCount = 0
  let failedCount = 0
  let skippedCount = 0

  for (const item of preview.previews) {
    if (item.skipReason !== null || !item.recipient || !item.message) {
      skippedCount += 1
      results.push({
        donorId: item.donorId,
        notification: null,
        status: 'SKIPPED',
        skipReason: item.skipReason ?? 'Unable to compose notification',
        error: null,
        recipientRedacted: item.recipientRedacted,
      })
      continue
    }

    const recipientRedacted = redactRecipient(body.channel, item.recipient)

    const inserted = await db
      .insert(notifications)
      .values({
        donorId: item.donorId,
        alertId: preview.alertId,
        channel: body.channel,
        recipient: item.recipient,
        message: item.message,
        status: 'PENDING',
        createdBy: createdByUserId,
      })
      .$returningId()

    const insertId = inserted?.[0]?.id
    if (typeof insertId !== 'number' || !Number.isFinite(insertId)) {
      throw AppError.internal('Failed to create notification record')
    }

    logInfo('notification.send.attempt', {
      notificationId: insertId,
      donorId: item.donorId,
      channel: body.channel,
      recipientRedacted,
      provider: provider.id,
    })

    let deliveryStatus: NotificationStatus = 'FAILED'
    let providerMessageId: string | null = null
    let sentAt: Date | null = null
    let error: string | null = null

    try {
      const result = await provider.send({
        channel: body.channel,
        to: item.recipient,
        body: item.message,
        subject: item.subject ?? undefined,
        metadata: {
          notificationId: String(insertId),
          donorId: String(item.donorId),
          ...(preview.alertId != null
            ? { alertId: String(preview.alertId) }
            : {}),
        },
      })

      if (result?.success && result.status === 'SENT') {
        deliveryStatus = 'SENT'
        providerMessageId = result.providerMessageId ?? null
        sentAt = result.sentAt ? new Date(result.sentAt) : now()
        sentCount += 1
      } else {
        deliveryStatus = 'FAILED'
        providerMessageId = result?.providerMessageId ?? null
        error = result?.error ?? 'Provider reported failure'
        failedCount += 1
        logWarn('notification.send.failed', {
          notificationId: insertId,
          donorId: item.donorId,
          channel: body.channel,
          recipientRedacted,
          provider: result?.provider ?? provider.id,
          error,
        })
      }
    } catch (err: unknown) {
      deliveryStatus = 'FAILED'
      error =
        err instanceof Error
          ? (err.message ?? 'Provider send threw').slice(0, 500)
          : 'Provider send threw'
      failedCount += 1
      logWarn('notification.send.failed', {
        notificationId: insertId,
        donorId: item.donorId,
        channel: body.channel,
        recipientRedacted,
        provider: provider.id,
        error,
      })
    }

    await db
      .update(notifications)
      .set({
        status: deliveryStatus,
        providerMessageId,
        sentAt,
        deliveryError: error,
      })
      .where(eq(notifications.id, insertId))

    const publicNotification = await getNotificationById(db, insertId)
    results.push({
      donorId: item.donorId,
      notification: publicNotification,
      status: deliveryStatus,
      skipReason: null,
      error,
      recipientRedacted,
    })
  }

  return {
    channel: body.channel,
    alertId: preview.alertId,
    results,
    sentCount,
    failedCount,
    skippedCount,
  }
}

export type EligibilityReminderRun = {
  eligibleDonors: number
  sentCount: number
  failedCount: number
  skippedCount: number
}

/** Daily, idempotent SMS + email reminders for consented eligible donors. */
export async function runEligibilityReminders(
  db: Db,
  deps: NotificationServiceDeps = {},
): Promise<EligibilityReminderRun> {
  const today = (deps.now?.() ?? new Date()).toISOString().slice(0, 10)
  const donorRows = await db.select().from(donors).where(eq(donors.active, true))
  const donationRows = await db
    .select({ donorId: donations.donorId, lastDonationDate: max(donations.donationDate) })
    .from(donations)
    .groupBy(donations.donorId)
  const lastByDonor = new Map(donationRows.map((row) => [row.donorId, row.lastDonationDate ?? null]))
  const [systemUser] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(users.status, 'ACTIVE'), eq(roles.name, 'Administrator')))
    .limit(1)
  if (!systemUser?.id) throw AppError.internal('An active Administrator is required for reminder audit ownership')

  let eligibleDonors = 0
  let sentCount = 0
  let failedCount = 0
  let skippedCount = 0
  const getProvider = deps.getProvider ?? ((channel: NotificationChannel) => createNotificationProvider(channel))

  for (const donor of donorRows) {
    const lastDonationDate = lastByDonor.get(donor.id) ?? null
    if (!lastDonationDate) continue
    const eligibility = calculateDonorEligibility({
      active: donor.active,
      dateOfBirth: donor.dateOfBirth ?? null,
      sex: donor.sex ?? null,
      weightKg: donor.weightKg == null ? null : Number(donor.weightKg),
      address: donor.address ?? null,
      phone: donor.phone ?? null,
      email: donor.email ?? null,
      lastDonationDate,
      today,
    })
    if (eligibility.status !== 'ELIGIBLE' || !eligibility.nextEligibleDate) continue
    eligibleDonors += 1

    const channels: NotificationChannel[] = []
    if (donor.smsConsent && donor.phone) channels.push('SMS')
    if (donor.emailConsent && donor.email) channels.push('EMAIL')
    if (channels.length === 0) { skippedCount += 1; continue }

    for (const channel of channels) {
      const recipient = channel === 'SMS' ? donor.phone! : donor.email!
      const deduplicationKey = `eligibility:${donor.id}:${channel}:${eligibility.nextEligibleDate}`
      const [existing] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.deduplicationKey, deduplicationKey))
        .limit(1)
      if (existing?.id) { skippedCount += 1; continue }

      const message = `Hello ${donor.firstName}, you have reached your preliminary blood donation eligibility date. Please visit an approved centre for staff screening before donating.`
      const inserted = await db.insert(notifications).values({
        donorId: donor.id,
        alertId: null,
        channel,
        recipient,
        message,
        status: 'PENDING',
        deduplicationKey,
        createdBy: systemUser.id,
      }).$returningId()
      const notificationId = inserted[0]?.id
      if (!notificationId) throw AppError.internal('Failed to create reminder record')

      const result = await getProvider(channel).send({
        channel,
        to: recipient,
        body: message,
        subject: channel === 'EMAIL' ? 'You may be eligible to donate blood again' : undefined,
        metadata: { notificationId: String(notificationId), donorId: String(donor.id) },
      })
      const status: NotificationStatus = result.success && result.status === 'SENT' ? 'SENT' : 'FAILED'
      if (status === 'SENT') sentCount += 1
      else failedCount += 1
      await db.update(notifications).set({
        status,
        providerMessageId: result.providerMessageId ?? null,
        sentAt: result.sentAt ? new Date(result.sentAt) : status === 'SENT' ? (deps.now?.() ?? new Date()) : null,
        deliveryError: result.error?.slice(0, 500) ?? null,
      }).where(eq(notifications.id, notificationId))
    }
  }

  return { eligibleDonors, sentCount, failedCount, skippedCount }
}
