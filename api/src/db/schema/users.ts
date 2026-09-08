import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core'

import { userStatuses } from './enums'

/**
 * Application users. Soft-deactivate via status=INACTIVE (docs/06).
 * Never store plaintext passwords — password_hash only.
 */
export const users = mysqlTable(
  'users',
  {
    id: int('id').autoincrement().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    status: mysqlEnum('status', userStatuses).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('users_status_idx').on(table.status)],
)

/**
 * Server-side sessions for HTTP-only cookie auth (docs/10).
 */
export const sessions = mysqlTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: varchar('user_agent', { length: 512 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
)
