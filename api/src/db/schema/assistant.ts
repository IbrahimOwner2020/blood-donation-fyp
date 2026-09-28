import {
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core'

import { healthcareFacilities } from './healthcare-facilities'
import { users } from './users'

export const assistantLanguages = ['en', 'sw'] as const
export const assistantMessageRoles = ['USER', 'ASSISTANT'] as const
export const assistantArtifactTypes = ['REPORT'] as const
export const assistantProposalStatuses = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'FAILED',
] as const

export type AssistantLanguage = (typeof assistantLanguages)[number]
export type AssistantMessageRole = (typeof assistantMessageRoles)[number]
export type AssistantArtifactType = (typeof assistantArtifactTypes)[number]
export type AssistantProposalStatus = (typeof assistantProposalStatuses)[number]

export type StoredAssistantBlock = Record<string, unknown>

export const assistantConversations = mysqlTable(
  'assistant_conversations',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    ownerUserId: int('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 160 }).notNull(),
    preferredLanguage: mysqlEnum('preferred_language', assistantLanguages)
      .notNull()
      .default('en'),
    lastMessageAt: timestamp('last_message_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('assistant_conversations_owner_activity_idx').on(
      table.ownerUserId,
      table.lastMessageAt,
    ),
    index('assistant_conversations_expires_idx').on(table.expiresAt),
  ],
)

export const assistantMessages = mysqlTable(
  'assistant_messages',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    conversationId: varchar('conversation_id', { length: 64 })
      .notNull()
      .references(() => assistantConversations.id, { onDelete: 'cascade' }),
    role: mysqlEnum('role', assistantMessageRoles).notNull(),
    language: mysqlEnum('language', assistantLanguages).notNull().default('en'),
    blocksJson: json('blocks_json').$type<StoredAssistantBlock[]>().notNull(),
    suggestionsJson: json('suggestions_json').$type<string[]>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('assistant_messages_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
    ),
  ],
)

export const assistantArtifacts = mysqlTable(
  'assistant_artifacts',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    conversationId: varchar('conversation_id', { length: 64 })
      .notNull()
      .references(() => assistantConversations.id, { onDelete: 'cascade' }),
    messageId: varchar('message_id', { length: 64 }).references(
      () => assistantMessages.id,
      { onDelete: 'set null' },
    ),
    ownerUserId: int('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    artifactType: mysqlEnum('artifact_type', assistantArtifactTypes).notNull(),
    reportType: varchar('report_type', { length: 80 }).notNull(),
    title: varchar('title', { length: 220 }).notNull(),
    requiredPermission: varchar('required_permission', { length: 80 }).notNull(),
    facilityId: int('facility_id').references(() => healthcareFacilities.id),
    filtersJson: json('filters_json').$type<Record<string, unknown>>().notNull(),
    snapshotJson: json('snapshot_json').$type<Record<string, unknown>>().notNull(),
    language: mysqlEnum('language', assistantLanguages).notNull().default('en'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('assistant_artifacts_owner_created_idx').on(
      table.ownerUserId,
      table.createdAt,
    ),
    index('assistant_artifacts_expires_idx').on(table.expiresAt),
  ],
)

export const assistantDrafts = mysqlTable(
  'assistant_drafts',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    conversationId: varchar('conversation_id', { length: 64 })
      .notNull()
      .references(() => assistantConversations.id, { onDelete: 'cascade' }),
    ownerUserId: int('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workflow: varchar('workflow', { length: 80 }).notNull(),
    valuesJson: json('values_json').$type<Record<string, unknown>>().notNull(),
    missingFieldsJson: json('missing_fields_json').$type<string[]>().notNull(),
    errorsJson: json('errors_json').$type<Record<string, string>>(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('assistant_drafts_owner_expires_idx').on(
      table.ownerUserId,
      table.expiresAt,
    ),
  ],
)

export const assistantActionProposals = mysqlTable(
  'assistant_action_proposals',
  {
    id: varchar('id', { length: 120 }).primaryKey(),
    conversationId: varchar('conversation_id', { length: 64 }).references(
      () => assistantConversations.id,
      { onDelete: 'cascade' },
    ),
    ownerUserId: int('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: varchar('session_id', { length: 128 }).notNull(),
    action: varchar('action', { length: 80 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    requiredPermission: varchar('required_permission', { length: 80 }).notNull(),
    payloadJson: json('payload_json').$type<Record<string, unknown>>().notNull(),
    effect: text('effect').notNull(),
    status: mysqlEnum('status', assistantProposalStatuses)
      .notNull()
      .default('PENDING'),
    expiresAt: timestamp('expires_at').notNull(),
    consumedAt: timestamp('consumed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('assistant_proposals_owner_status_idx').on(
      table.ownerUserId,
      table.status,
    ),
    index('assistant_proposals_expires_idx').on(table.expiresAt),
  ],
)
