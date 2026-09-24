import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

import { donors } from './donors'
import { notificationChannels, notificationStatuses } from './enums'
import { shortageAlerts } from './shortage-alerts'
import { users } from './users'

export const notifications = mysqlTable(
  'notifications',
  {
    id: int('id').autoincrement().primaryKey(),
    donorId: int('donor_id')
      .notNull()
      .references(() => donors.id),
    alertId: int('alert_id').references(() => shortageAlerts.id),
    channel: mysqlEnum('channel', notificationChannels).notNull(),
    recipient: varchar('recipient', { length: 255 }).notNull(),
    message: text('message').notNull(),
    status: mysqlEnum('status', notificationStatuses)
      .notNull()
      .default('PENDING'),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    deduplicationKey: varchar('deduplication_key', { length: 255 }),
    deliveryError: varchar('delivery_error', { length: 500 }),
    sentAt: timestamp('sent_at'),
    createdBy: int('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('notifications_donor_created_idx').on(
      table.donorId,
      table.createdAt,
    ),
    index('notifications_alert_id_idx').on(table.alertId),
    index('notifications_status_idx').on(table.status),
    uniqueIndex('notifications_deduplication_key_uidx').on(table.deduplicationKey),
  ],
)
