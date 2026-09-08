import {
  index,
  int,
  json,
  mysqlTable,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core'

import { users } from './users'

export type ActivityMetadata = Record<
  string,
  string | number | boolean | null | undefined
>

export const activityLogs = mysqlTable(
  'activity_logs',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id').references(() => users.id),
    action: varchar('action', { length: 120 }).notNull(),
    entityType: varchar('entity_type', { length: 120 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }),
    metadataJson: json('metadata_json').$type<ActivityMetadata | null>(),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('activity_logs_user_created_idx').on(table.userId, table.createdAt),
    index('activity_logs_entity_idx').on(table.entityType, table.entityId),
  ],
)
