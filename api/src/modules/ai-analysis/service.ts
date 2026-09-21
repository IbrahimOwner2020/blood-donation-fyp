import {
  and,
  count,
  desc,
  eq,
  inArray,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm'

import type { Db } from '../../db'
import {
  aiAnalysisRuns,
  aiAnalysisSettings,
  bloodGroups,
  demandRecords,
  donationCentres,
  permissions,
  rolePermissions,
  shortageAlerts,
  userRoles,
  users,
} from '../../db/schema'
import type {
  AiAnalysisCentreRecommendation,
  AiAnalysisDonorRecommendation,
  AiAnalysisNotificationMode,
  AiAnalysisRecommendations,
  AiAnalysisRiskLevel,
  AiAnalysisRunStatus,
  AiAnalysisRunTrigger,
  AiAnalysisShortage,
} from '../../db/schema/ai-analysis'
import { AppError } from '../../lib/errors'
import { logWarn } from '../../lib/logger'
import { createEmailProvider } from '../../services/notifications'
import { AiAnalysisAuditActions, recordActivity } from '../../services/audit'
import { syncDemandFromBloodRequests } from '../demand'
import { listMatchesForAlert } from '../alerts/matching-service'
import { sendNotifications } from '../notifications/service'
import { runPrediction } from '../predictions/service'
import { afterPredictionPersisted } from '../alerts/hooks'
import type { ListAiAnalysisQuery } from './schemas'
import {
  toPublicAiAnalysisRun,
  type AiAnalysisRunRow,
  type PublicAiAnalysisRun,
  type PublicAiAnalysisSettings,
} from './serialize'

type ActorContext = {
  userId: number | null
  requestId?: string | null
  ipAddress?: string | null
}

type RunAiAnalysisInput = {
  triggerType: AiAnalysisRunTrigger
  actor?: ActorContext
  horizonDays?: number
  notificationMode?: AiAnalysisNotificationMode
}

type ApprovalRecipient = {
  id: number
  name: string
  email: string
}

type BloodGroupRow = typeof bloodGroups.$inferSelect
type AlertRow = typeof shortageAlerts.$inferSelect

function mapRunRow(row: typeof aiAnalysisRuns.$inferSelect): AiAnalysisRunRow {
  return {
    id: row.id,
    triggerType: row.triggerType,
    triggeredByUserId: row.triggeredByUserId ?? null,
    status: row.status,
    horizonDays: row.horizonDays,
    riskLevel: row.riskLevel,
    notificationMode: row.notificationMode,
    conclusion: row.conclusion,
    predictionIdsJson: row.predictionIdsJson ?? null,
    alertIdsJson: row.alertIdsJson ?? null,
    recommendationsJson: row.recommendationsJson ?? null,
    failureDetails: row.failureDetails ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
  }
}

function decimalNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy
}

function maxRisk(
  shortages: AiAnalysisShortage[],
): AiAnalysisRiskLevel {
  const rank: Record<string, number> = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4,
  }
  let winner: AiAnalysisRiskLevel = 'LOW'
  for (const item of shortages) {
    if ((rank[item.severity] ?? 0) > rank[winner]) {
      winner = item.severity as AiAnalysisRiskLevel
    }
  }
  return winner
}

function statusFor(
  predictionIds: number[],
  failures: string[],
): AiAnalysisRunStatus {
  if (!predictionIds.length && failures.length) return 'FAILED'
  if (predictionIds.length && failures.length) return 'PARTIAL'
  return 'COMPLETED'
}

function buildConclusion(input: {
  horizonDays: number
  shortages: AiAnalysisShortage[]
  donors: AiAnalysisDonorRecommendation[]
  centres: AiAnalysisCentreRecommendation[]
  currentUsage: number
  previousUsage: number
  failures: string[]
}): string {
  const usageDirection =
    input.currentUsage > input.previousUsage
      ? 'higher than'
      : input.currentUsage < input.previousUsage
        ? 'lower than'
        : 'similar to'
  if (!input.shortages.length) {
    return (
      `AI analysis found no projected blood short supply in the next ${input.horizonDays} days. ` +
      `Recent usage was ${input.currentUsage} units, ${usageDirection} the previous comparable period of ${input.previousUsage} units. ` +
      `Continue routine monitoring and donor engagement.`
    )
  }

  const shortageText = input.shortages
    .slice(0, 4)
    .map((item) => `${item.bloodGroupCode ?? `group #${item.bloodGroupId}`} gap ${item.projectedGap.toFixed(2)} units`)
    .join(', ')
  const centreText = input.centres
    .slice(0, 3)
    .map((centre) => `${centre.name} (${centre.region})`)
    .join(', ')

  return (
    `AI analysis predicts possible blood short supply in the next ${input.horizonDays} days: ${shortageText}. ` +
    `Recent usage was ${input.currentUsage} units, ${usageDirection} the previous comparable period of ${input.previousUsage} units. ` +
    `Reach out to ${input.donors.length} potentially eligible donor${input.donors.length === 1 ? '' : 's'} and direct them to ${centreText || 'active donation centres'}.`
  )
}

async function audit(
  input: ActorContext | undefined,
  action: string,
  entityId: number | null,
  metadata: Record<string, string | number | boolean | null | undefined>,
): Promise<void> {
  await recordActivity({
    actorUserId: input?.userId ?? null,
    action,
    entityType: 'ai_analysis',
    entityId,
    metadata,
    requestId: input?.requestId ?? null,
    ipAddress: input?.ipAddress ?? null,
  })
}

async function getBloodGroups(db: Db): Promise<BloodGroupRow[]> {
  return db.select().from(bloodGroups)
}

async function getUsageTotals(db: Db, horizonDays: number): Promise<{
  currentUsage: number
  previousUsage: number
}> {
  const today = new Date()
  const currentFrom = dateOnly(addDays(today, -horizonDays))
  const previousFrom = dateOnly(addDays(today, -horizonDays * 2))
  const previousTo = dateOnly(addDays(today, -horizonDays - 1))

  const [current] = await db
    .select({ value: sum(demandRecords.unitsRequested) })
    .from(demandRecords)
    .where(sql`${demandRecords.date} >= ${currentFrom}`)
  const [previous] = await db
    .select({ value: sum(demandRecords.unitsRequested) })
    .from(demandRecords)
    .where(
      and(
        sql`${demandRecords.date} >= ${previousFrom}`,
        sql`${demandRecords.date} <= ${previousTo}`,
      ),
    )

  return {
    currentUsage: decimalNumber(current?.value ?? 0),
    previousUsage: decimalNumber(previous?.value ?? 0),
  }
}

async function alertsForPredictions(
  db: Db,
  predictionIds: number[],
): Promise<Array<{ alert: AlertRow; bloodGroupCode: string | null }>> {
  if (!predictionIds.length) return []
  const rows = await db
    .select({
      alert: shortageAlerts,
      bloodGroupCode: bloodGroups.code,
    })
    .from(shortageAlerts)
    .leftJoin(bloodGroups, eq(shortageAlerts.bloodGroupId, bloodGroups.id))
    .where(inArray(shortageAlerts.predictionId, predictionIds))

  return (rows ?? []).filter((row): row is {
    alert: AlertRow
    bloodGroupCode: string | null
  } => Boolean(row?.alert?.id))
}

async function activeCentres(
  db: Db,
): Promise<AiAnalysisCentreRecommendation[]> {
  const rows = await db
    .select()
    .from(donationCentres)
    .where(eq(donationCentres.active, true))
  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    region: row.region,
    address: row.address ?? null,
  }))
}

async function approvalRecipients(db: Db): Promise<ApprovalRecipient[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      permission: permissions.code,
    })
    .from(users)
    .innerJoin(userRoles, eq(users.id, userRoles.userId))
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(
      and(
        eq(users.status, 'ACTIVE'),
        inArray(permissions.code, ['notifications:send', 'reports:read']),
      ),
    )

  const byUser = new Map<number, ApprovalRecipient & { perms: Set<string> }>()
  for (const row of rows ?? []) {
    const existing = byUser.get(row.id) ?? {
      id: row.id,
      name: row.name,
      email: row.email,
      perms: new Set<string>(),
    }
    existing.perms.add(row.permission)
    byUser.set(row.id, existing)
  }

  return [...byUser.values()]
    .filter((row) => row.perms.has('notifications:send') && row.perms.has('reports:read'))
    .map(({ perms: _perms, ...row }) => row)
}

async function sendApprovalEmails(input: {
  db: Db
  runId: number
  recipients: ApprovalRecipient[]
  conclusion: string
  actor?: ActorContext
}): Promise<string[]> {
  if (!input.recipients.length) return []
  const provider = createEmailProvider()
  const delivered: string[] = []
  for (const recipient of input.recipients) {
    const result = await provider.send({
      channel: 'EMAIL',
      to: recipient.email,
      subject: `NBTS AI report #${input.runId} requires approval`,
      body:
        `Hello ${recipient.name},\n\n` +
        `The daily AI supply analysis has recommendations that require approval before donor notifications are sent.\n\n` +
        `${input.conclusion}\n\n` +
        `Open AI report #${input.runId} in the NBTS dashboard to review and approve donor outreach.`,
      metadata: {
        aiAnalysisRunId: String(input.runId),
      },
    })
    if (result.success) {
      delivered.push(recipient.email)
    } else {
      logWarn('ai_analysis.approval_email_failed', {
        runId: input.runId,
        userId: recipient.id,
        error: result.error ?? 'unknown',
      })
    }
  }
  if (delivered.length) {
    await audit(input.actor, AiAnalysisAuditActions.NOTIFICATION_APPROVAL_REQUESTED, input.runId, {
      recipientCount: delivered.length,
    })
  }
  return delivered
}

async function autoSendDonorNotifications(input: {
  db: Db
  runId: number
  shortages: AiAnalysisShortage[]
  donors: AiAnalysisDonorRecommendation[]
  senderUserId: number | null
  actor?: ActorContext
}): Promise<number[]> {
  if (!input.donors.length || !input.senderUserId) return []
  const ids: number[] = []
  for (const shortage of input.shortages) {
    const donorsForAlert = input.donors.filter((donor) => donor.alertId === shortage.alertId)
    const smsIds = donorsForAlert.map((donor) => donor.id)
    if (!smsIds.length) continue
    const result = await sendNotifications(
      input.db,
      {
        donorIds: smsIds,
        channel: 'SMS',
        alertId: shortage.alertId,
        message:
          `NBTS requests ${shortage.bloodGroupCode ?? 'your blood group'} donors to donate at the nearest active donation centre because supply may be short in the next 2 months.`,
      },
      input.senderUserId,
    )
    ids.push(
      ...result.results
        .map((item) => item.notification?.id)
        .filter((id): id is number => typeof id === 'number'),
    )
  }
  if (ids.length) {
    await audit(input.actor, AiAnalysisAuditActions.NOTIFICATION_AUTO_SENT, input.runId, {
      notificationCount: ids.length,
      senderUserId: input.senderUserId,
    })
  }
  return ids
}

export async function getAiAnalysisSettings(
  db: Db,
): Promise<PublicAiAnalysisSettings> {
  const rows = await db
    .select()
    .from(aiAnalysisSettings)
    .where(eq(aiAnalysisSettings.id, 1))
    .limit(1)
  const row = rows?.[0]
  if (row) {
    return { notificationMode: row.notificationMode }
  }
  await db.insert(aiAnalysisSettings).values({
    id: 1,
    notificationMode: 'REQUIRE_APPROVAL',
  })
  return { notificationMode: 'REQUIRE_APPROVAL' }
}

export async function updateAiAnalysisSettings(
  db: Db,
  notificationMode: AiAnalysisNotificationMode,
  actorUserId: number | null,
): Promise<PublicAiAnalysisSettings> {
  await getAiAnalysisSettings(db)
  await db
    .update(aiAnalysisSettings)
    .set({
      notificationMode,
      updatedByUserId: actorUserId,
    })
    .where(eq(aiAnalysisSettings.id, 1))
  return { notificationMode }
}

function listWhere(query: ListAiAnalysisQuery): SQL | undefined {
  const parts: SQL[] = []
  if (query.triggerType) parts.push(eq(aiAnalysisRuns.triggerType, query.triggerType))
  if (query.notificationMode) {
    parts.push(eq(aiAnalysisRuns.notificationMode, query.notificationMode))
  }
  if (!parts.length) return undefined
  return parts.length === 1 ? parts[0] : and(...parts)
}

export async function listAiAnalysisRuns(
  db: Db,
  query: ListAiAnalysisQuery,
): Promise<{
  items: PublicAiAnalysisRun[]
  total: number
  limit: number
  offset: number
}> {
  const limit = query.limit ?? 50
  const offset = query.offset ?? 0
  const where = listWhere(query)
  const [totalRow] = await db
    .select({ value: count() })
    .from(aiAnalysisRuns)
    .where(where)
  const rows = await db
    .select()
    .from(aiAnalysisRuns)
    .where(where)
    .orderBy(desc(aiAnalysisRuns.createdAt), desc(aiAnalysisRuns.id))
    .limit(limit)
    .offset(offset)
  return {
    items: (rows ?? [])
      .map((row) => toPublicAiAnalysisRun(mapRunRow(row)))
      .filter((row): row is PublicAiAnalysisRun => row !== null),
    total: Number(totalRow?.value ?? 0),
    limit,
    offset,
  }
}

export async function getAiAnalysisById(
  db: Db,
  id: number,
): Promise<PublicAiAnalysisRun> {
  const rows = await db
    .select()
    .from(aiAnalysisRuns)
    .where(eq(aiAnalysisRuns.id, id))
    .limit(1)
  const row = rows?.[0] ? toPublicAiAnalysisRun(mapRunRow(rows[0])) : null
  if (!row) {
    throw AppError.notFound('AI analysis report not found')
  }
  return row
}

export async function runAiAnalysis(
  db: Db,
  input: RunAiAnalysisInput,
): Promise<PublicAiAnalysisRun> {
  const settings = await getAiAnalysisSettings(db)
  const horizonDays = input.horizonDays ?? 60
  const notificationMode = input.notificationMode ?? settings.notificationMode
  const actor = input.actor
  const action =
    input.triggerType === 'SCHEDULED'
      ? AiAnalysisAuditActions.SCHEDULED_STARTED
      : AiAnalysisAuditActions.RUN_REQUESTED

  const inserted = await db
    .insert(aiAnalysisRuns)
    .values({
      triggerType: input.triggerType,
      triggeredByUserId: actor?.userId ?? null,
      status: 'RUNNING',
      horizonDays,
      notificationMode,
      riskLevel: 'LOW',
      conclusion: 'AI analysis started.',
      predictionIdsJson: [],
      alertIdsJson: [],
      recommendationsJson: null,
    })
    .$returningId()

  const runId = inserted?.[0]?.id
  if (typeof runId !== 'number' || !Number.isFinite(runId)) {
    throw AppError.internal('Failed to create AI analysis report')
  }

  await audit(actor, action, runId, {
    triggerType: input.triggerType,
    horizonDays,
    notificationMode,
  })

  const predictionIds: number[] = []
  const failures: string[] = []

  try {
    await syncDemandFromBloodRequests(db, {})
    await audit(actor, AiAnalysisAuditActions.DATA_ACCESSED, runId, {
      source: 'demand_records,blood_groups,blood_inventory',
      purpose: 'daily_supply_analysis',
    })

    const groups = await getBloodGroups(db)
    for (const group of groups) {
      try {
        const result = await runPrediction(
          db,
          {
            bloodGroupId: group.id,
            horizonDays: horizonDays as 7 | 14 | 30 | 60,
            syncDemand: false,
            train: false,
          },
          { afterPredictionPersisted },
        )
        predictionIds.push(result.prediction.id)
      } catch (error) {
        failures.push(
          `${group.code}: ${error instanceof Error ? error.message : 'unknown forecast failure'}`,
        )
      }
    }

    const alertRows = await alertsForPredictions(db, predictionIds)
    const shortages: AiAnalysisShortage[] = alertRows.map((row) => ({
      alertId: row.alert.id,
      predictionId: row.alert.predictionId,
      bloodGroupId: row.alert.bloodGroupId,
      bloodGroupCode: row.bloodGroupCode,
      severity: row.alert.severity,
      status: row.alert.status,
      availableUnits: decimalNumber(row.alert.availableUnits),
      predictedUnits: decimalNumber(row.alert.predictedUnits),
      projectedGap: decimalNumber(row.alert.projectedGap),
    }))
    const alertIds = shortages.map((item) => item.alertId)

    const donors: AiAnalysisDonorRecommendation[] = []
    for (const shortage of shortages) {
      try {
        const matches = await listMatchesForAlert(db, shortage.alertId, {
          limit: 25,
          offset: 0,
        })
        donors.push(
          ...matches.items.map((donor) => ({
            id: donor.id,
            donorNumber: donor.donorNumber,
            firstName: donor.firstName,
            lastName: donor.lastName,
            bloodGroupCode: donor.bloodGroup?.code ?? null,
            alertId: shortage.alertId,
            contactAvailable: Boolean(donor.phone || donor.email),
          })),
        )
      } catch (error) {
        failures.push(
          `alert #${shortage.alertId} matches: ${error instanceof Error ? error.message : 'unknown matching failure'}`,
        )
      }
    }

    const centres = await activeCentres(db)
    const usage = await getUsageTotals(db, horizonDays)
    const conclusion = buildConclusion({
      horizonDays,
      shortages,
      donors,
      centres,
      currentUsage: usage.currentUsage,
      previousUsage: usage.previousUsage,
      failures,
    })
    const recipients = await approvalRecipients(db)
    let approvalEmailRecipients: string[] = []
    let notificationIds: number[] = []

    if (shortages.length && notificationMode === 'REQUIRE_APPROVAL') {
      approvalEmailRecipients = await sendApprovalEmails({
        db,
        runId,
        recipients,
        conclusion,
        actor,
      })
    } else if (shortages.length && notificationMode === 'AUTO_SEND') {
      const senderUserId = actor?.userId ?? recipients[0]?.id ?? null
      notificationIds = await autoSendDonorNotifications({
        db,
        runId,
        shortages,
        donors,
        senderUserId,
        actor,
      })
      if (!senderUserId) {
        failures.push('AUTO_SEND skipped because no active approval-capable sender user exists')
      }
    }

    const recommendations: AiAnalysisRecommendations = {
      shortages,
      donors,
      centres,
      notificationIds,
      approvalEmailRecipients,
      failures,
    }
    const status = statusFor(predictionIds, failures)
    const riskLevel = maxRisk(shortages)

    await db
      .update(aiAnalysisRuns)
      .set({
        status,
        riskLevel,
        conclusion,
        predictionIdsJson: predictionIds,
        alertIdsJson: alertIds,
        recommendationsJson: recommendations,
        failureDetails: failures.length ? failures.join('\n') : null,
        completedAt: new Date(),
      })
      .where(eq(aiAnalysisRuns.id, runId))

    await audit(
      actor,
      status === 'FAILED'
        ? AiAnalysisAuditActions.FAILED
        : AiAnalysisAuditActions.COMPLETED,
      runId,
      {
        status,
        predictionCount: predictionIds.length,
        alertCount: alertIds.length,
        donorRecommendationCount: donors.length,
        notificationMode,
        riskLevel,
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown analysis failure'
    await db
      .update(aiAnalysisRuns)
      .set({
        status: 'FAILED',
        riskLevel: 'LOW',
        conclusion: `AI analysis failed before the report could be completed: ${message}`,
        failureDetails: message,
        completedAt: new Date(),
      })
      .where(eq(aiAnalysisRuns.id, runId))
    await audit(actor, AiAnalysisAuditActions.FAILED, runId, {
      status: 'FAILED',
      message,
    })
  }

  return getAiAnalysisById(db, runId)
}
