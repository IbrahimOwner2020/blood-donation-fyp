/**
 * Activity log list queries (docs/06 activity_logs, docs/10 audit).
 */

import {
  and,
  count,
  desc,
  eq,
  gte,
  like,
  lte,
  type SQL,
} from 'drizzle-orm'

import type { Db } from '../../db'
import { activityLogs, users } from '../../db/schema'
import type { ListActivityLogsQuery } from './schemas'
import {
  toPublicActivityLog,
  type ActivityLogRow,
  type ActorJoinRow,
  type PublicActivityLog,
} from './serialize'

export type ListActivityLogsResult = {
  items: PublicActivityLog[]
  total: number
  limit: number
  offset: number
}

function mapActivityRow(
  row: typeof activityLogs.$inferSelect,
): ActivityLogRow {
  return {
    id: row.id,
    userId: row.userId ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId ?? null,
    metadataJson: row.metadataJson ?? null,
    ipAddress: row.ipAddress ?? null,
    createdAt: row.createdAt,
  }
}

function mapActorRow(
  actorId: number | null | undefined,
  actorName: string | null | undefined,
): ActorJoinRow | null {
  if (typeof actorId !== 'number' || !Number.isFinite(actorId)) {
    return null
  }
  return {
    id: actorId,
    name: typeof actorName === 'string' ? actorName : '',
  }
}

function buildListConditions(query: ListActivityLogsQuery): SQL | undefined {
  const parts: SQL[] = []

  if (typeof query.userId === 'number' && Number.isFinite(query.userId)) {
    parts.push(eq(activityLogs.userId, query.userId))
  }

  const action = query.action?.trim()
  if (action) {
    parts.push(eq(activityLogs.action, action))
  }

  const entityType = query.entityType?.trim()
  if (entityType) {
    parts.push(eq(activityLogs.entityType, entityType))
  }

  const entityId = query.entityId?.trim()
  if (entityId) {
    parts.push(eq(activityLogs.entityId, entityId))
  }

  const q = query.q?.trim()
  if (q) {
    parts.push(like(activityLogs.action, `%${q}%`))
  }

  if (query.createdFrom instanceof Date) {
    parts.push(gte(activityLogs.createdAt, query.createdFrom))
  }

  if (query.createdTo instanceof Date) {
    parts.push(lte(activityLogs.createdAt, query.createdTo))
  }

  if (parts.length === 0) {
    return undefined
  }
  return and(...parts)
}

/**
 * List activity logs newest-first with optional filters + pagination.
 */
export async function listActivityLogs(
  db: Db,
  query: ListActivityLogsQuery,
): Promise<ListActivityLogsResult> {
  const limit = query.limit ?? 50
  const offset = query.offset ?? 0
  const whereClause = buildListConditions(query)

  const [totalRow] = await db
    .select({ value: count() })
    .from(activityLogs)
    .where(whereClause)

  const total = Number(totalRow?.value ?? 0)

  const rows = await db
    .select({
      log: activityLogs,
      actorId: users.id,
      actorName: users.name,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .where(whereClause)
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
    .limit(limit)
    .offset(offset)

  const items = (rows ?? [])
    .map((row) =>
      toPublicActivityLog(
        row?.log ? mapActivityRow(row.log) : null,
        mapActorRow(row?.actorId, row?.actorName),
      ),
    )
    .filter((item): item is PublicActivityLog => item !== null)

  return { items, total, limit, offset }
}
