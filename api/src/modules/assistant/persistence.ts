import { and, desc, eq, gt, lt } from 'drizzle-orm'

import type { Db } from '../../db/client'
import {
  assistantActionProposals,
  assistantArtifacts,
  assistantConversations,
  assistantDrafts,
  assistantMessages,
  type AssistantLanguage,
} from '../../db/schema'
import { AppError } from '../../lib/errors'
import type { AssistantBlock } from './schemas'

const CONVERSATION_TTL_MS = 90 * 24 * 60 * 60 * 1000
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
const PROPOSAL_TTL_MS = 15 * 60 * 1000

export type AssistantConversation = typeof assistantConversations.$inferSelect
export type AssistantMessageRow = typeof assistantMessages.$inferSelect
export type AssistantArtifact = typeof assistantArtifacts.$inferSelect
export type AssistantDraft = typeof assistantDrafts.$inferSelect

function future(ms: number, now = new Date()): Date {
  return new Date(now.getTime() + ms)
}

export function assistantId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export function redactAssistantText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/(?:\+?255|0)\s*\d(?:[\s-]*\d){8}/g, '[phone redacted]')
}

/**
 * Messages are long-lived conversation history, so they must not become a
 * second copy of short-lived workflow secrets. Full draft values live only in
 * assistant_drafts and executable proposal payloads live only in
 * assistant_action_proposals.
 */
export function sanitizeAssistantBlock(block: AssistantBlock): AssistantBlock {
  if (block.type === 'text') {
    return { ...block, content: redactAssistantText(block.content) }
  }
  if (block.type === 'form') {
    return {
      ...block,
      fields: block.fields.map((field) => /(?:phone|email)/i.test(field.name)
        ? { ...field, value: undefined }
        : field),
    }
  }
  if (block.type === 'action_proposal') {
    return {
      ...block,
      proposal: { ...block.proposal, payload: {} },
    }
  }
  if (block.type === 'composition') {
    return {
      ...block,
      summary: redactAssistantText(block.summary),
      sections: block.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((item) => {
          if (item.type === 'narrative') return { ...item, content: redactAssistantText(item.content) }
          if (item.type === 'notice' || item.type === 'recommendation') return { ...item, message: redactAssistantText(item.message) }
          return item
        }),
      })),
    }
  }
  return block
}

export async function listAssistantConversations(db: Db, ownerUserId: number) {
  return db
    .select()
    .from(assistantConversations)
    .where(and(
      eq(assistantConversations.ownerUserId, ownerUserId),
      gt(assistantConversations.expiresAt, new Date()),
    ))
    .orderBy(desc(assistantConversations.lastMessageAt))
    .limit(100)
}

export async function createAssistantConversation(
  db: Db,
  ownerUserId: number,
  input: { title?: string; preferredLanguage?: AssistantLanguage },
) {
  const id = assistantId('conv')
  const now = new Date()
  await db.insert(assistantConversations).values({
    id,
    ownerUserId,
    title: input.title?.trim() || (input.preferredLanguage === 'sw' ? 'Mazungumzo mapya' : 'New conversation'),
    preferredLanguage: input.preferredLanguage ?? 'en',
    lastMessageAt: now,
    expiresAt: future(CONVERSATION_TTL_MS, now),
  })
  return getAssistantConversation(db, id, ownerUserId)
}

export async function getAssistantConversation(db: Db, id: string, ownerUserId: number) {
  const [row] = await db
    .select()
    .from(assistantConversations)
    .where(and(
      eq(assistantConversations.id, id),
      eq(assistantConversations.ownerUserId, ownerUserId),
      gt(assistantConversations.expiresAt, new Date()),
    ))
    .limit(1)
  if (!row) throw AppError.notFound('Assistant conversation was not found or has expired')
  return row
}

export async function getAssistantConversationWithMessages(db: Db, id: string, ownerUserId: number) {
  const conversation = await getAssistantConversation(db, id, ownerUserId)
  const messages = await db
    .select()
    .from(assistantMessages)
    .where(eq(assistantMessages.conversationId, id))
    .orderBy(assistantMessages.createdAt)
    .limit(500)
  return { conversation, messages }
}

export async function updateAssistantConversation(
  db: Db,
  id: string,
  ownerUserId: number,
  patch: { title?: string; preferredLanguage?: AssistantLanguage },
) {
  await getAssistantConversation(db, id, ownerUserId)
  await db.update(assistantConversations).set({
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.preferredLanguage !== undefined ? { preferredLanguage: patch.preferredLanguage } : {}),
  }).where(eq(assistantConversations.id, id))
  return getAssistantConversation(db, id, ownerUserId)
}

export async function deleteAssistantConversation(db: Db, id: string, ownerUserId: number) {
  await getAssistantConversation(db, id, ownerUserId)
  await db.delete(assistantConversations).where(eq(assistantConversations.id, id))
}

export async function addAssistantMessage(
  db: Db,
  input: {
    conversationId: string
    ownerUserId: number
    role: 'USER' | 'ASSISTANT'
    language: AssistantLanguage
    blocks: AssistantBlock[]
    suggestions?: string[]
  },
) {
  const conversation = await getAssistantConversation(db, input.conversationId, input.ownerUserId)
  const id = assistantId('msg')
  const now = new Date()
  const blocks = input.blocks.map(sanitizeAssistantBlock)
  await db.insert(assistantMessages).values({
    id,
    conversationId: input.conversationId,
    role: input.role,
    language: input.language,
    blocksJson: blocks,
    suggestionsJson: input.suggestions ?? [],
    createdAt: now,
  })
  const isFirstUserMessage = input.role === 'USER' && conversation.title.match(/^(New conversation|Mazungumzo mapya)$/)
  const firstText = blocks.find((block) => block.type === 'text')
  await db.update(assistantConversations).set({
    lastMessageAt: now,
    expiresAt: future(CONVERSATION_TTL_MS, now),
    ...(isFirstUserMessage && firstText?.type === 'text'
      ? { title: firstText.content.slice(0, 80) }
      : {}),
  }).where(eq(assistantConversations.id, input.conversationId))
  const [row] = await db.select().from(assistantMessages).where(eq(assistantMessages.id, id)).limit(1)
  if (!row) throw new Error('Assistant message was not persisted')
  return row
}

export async function createAssistantArtifact(
  db: Db,
  input: {
    conversationId: string
    messageId?: string
    ownerUserId: number
    reportType: string
    title: string
    requiredPermission: string
    facilityId?: number | null
    filters: Record<string, unknown>
    snapshot: Record<string, unknown>
    language: AssistantLanguage
  },
) {
  await getAssistantConversation(db, input.conversationId, input.ownerUserId)
  const id = assistantId('report')
  await db.insert(assistantArtifacts).values({
    id,
    conversationId: input.conversationId,
    messageId: input.messageId ?? null,
    ownerUserId: input.ownerUserId,
    artifactType: 'REPORT',
    reportType: input.reportType,
    title: input.title,
    requiredPermission: input.requiredPermission,
    facilityId: input.facilityId ?? null,
    filtersJson: input.filters,
    snapshotJson: input.snapshot,
    language: input.language,
    expiresAt: future(CONVERSATION_TTL_MS),
  })
  return getAssistantArtifact(db, id, input.ownerUserId)
}

export async function getAssistantArtifact(db: Db, id: string, ownerUserId: number) {
  const [row] = await db.select().from(assistantArtifacts).where(and(
    eq(assistantArtifacts.id, id),
    eq(assistantArtifacts.ownerUserId, ownerUserId),
    gt(assistantArtifacts.expiresAt, new Date()),
  )).limit(1)
  if (!row) throw AppError.notFound('Assistant report was not found or has expired')
  return row
}

export async function createAssistantDraft(
  db: Db,
  input: {
    conversationId: string
    ownerUserId: number
    workflow: string
    values: Record<string, unknown>
    missingFields: string[]
    errors?: Record<string, string>
  },
) {
  await getAssistantConversation(db, input.conversationId, input.ownerUserId)
  const id = assistantId('draft')
  await db.insert(assistantDrafts).values({
    id,
    conversationId: input.conversationId,
    ownerUserId: input.ownerUserId,
    workflow: input.workflow,
    valuesJson: input.values,
    missingFieldsJson: input.missingFields,
    errorsJson: input.errors ?? null,
    expiresAt: future(DRAFT_TTL_MS),
  })
  return getAssistantDraft(db, id, input.ownerUserId)
}

export async function getAssistantDraft(db: Db, id: string, ownerUserId: number) {
  const [row] = await db.select().from(assistantDrafts).where(and(
    eq(assistantDrafts.id, id),
    eq(assistantDrafts.ownerUserId, ownerUserId),
    gt(assistantDrafts.expiresAt, new Date()),
  )).limit(1)
  if (!row) throw AppError.notFound('Assistant form draft was not found or has expired')
  return row
}

export async function updateAssistantDraft(
  db: Db,
  id: string,
  ownerUserId: number,
  patch: { values: Record<string, unknown>; missingFields: string[]; errors?: Record<string, string> },
) {
  await getAssistantDraft(db, id, ownerUserId)
  await db.update(assistantDrafts).set({
    valuesJson: patch.values,
    missingFieldsJson: patch.missingFields,
    errorsJson: patch.errors ?? null,
    expiresAt: future(DRAFT_TTL_MS),
  }).where(eq(assistantDrafts.id, id))
  return getAssistantDraft(db, id, ownerUserId)
}

export type PersistedProposalInput = {
  id: string
  action: string
  title: string
  description: string
  requiredPermission: string
  payload: Record<string, unknown>
  effect: string
}

export async function persistAssistantProposal(
  db: Db,
  proposal: PersistedProposalInput,
  owner: { userId: number; sessionId: string },
  conversationId?: string,
) {
  const expiresAt = future(PROPOSAL_TTL_MS)
  await db.insert(assistantActionProposals).values({
    id: proposal.id,
    conversationId: conversationId ?? null,
    ownerUserId: owner.userId,
    sessionId: owner.sessionId,
    action: proposal.action,
    title: proposal.title,
    description: proposal.description,
    requiredPermission: proposal.requiredPermission,
    payloadJson: proposal.payload,
    effect: proposal.effect,
    expiresAt,
  })
  return { ...proposal, expiresAt }
}

export async function consumeAssistantProposal(
  db: Db,
  id: string,
  owner: { userId: number; sessionId: string },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(assistantActionProposals).where(and(
      eq(assistantActionProposals.id, id),
      eq(assistantActionProposals.ownerUserId, owner.userId),
      eq(assistantActionProposals.sessionId, owner.sessionId),
      eq(assistantActionProposals.status, 'PENDING'),
      gt(assistantActionProposals.expiresAt, new Date()),
    )).limit(1)
    if (!row) return null
    const now = new Date()
    const result = await tx.update(assistantActionProposals).set({
      status: 'CONFIRMED',
      consumedAt: now,
    }).where(and(
      eq(assistantActionProposals.id, id),
      eq(assistantActionProposals.status, 'PENDING'),
    ))
    const affectedRows = Number((result as unknown as { [key: number]: { affectedRows?: number } })?.[0]?.affectedRows ?? 1)
    if (affectedRows < 1) return null
    return {
      id: row.id,
      conversationId: row.conversationId,
      action: row.action,
      title: row.title,
      description: row.description,
      requiredPermission: row.requiredPermission,
      payload: row.payloadJson,
      effect: row.effect,
    }
  })
}

export async function cancelAssistantProposal(
  db: Db,
  id: string,
  owner: { userId: number; sessionId: string },
) {
  const result = await db.update(assistantActionProposals).set({
    status: 'CANCELLED',
    consumedAt: new Date(),
  }).where(and(
    eq(assistantActionProposals.id, id),
    eq(assistantActionProposals.ownerUserId, owner.userId),
    eq(assistantActionProposals.sessionId, owner.sessionId),
    eq(assistantActionProposals.status, 'PENDING'),
    gt(assistantActionProposals.expiresAt, new Date()),
  ))
  return Number((result as unknown as { [key: number]: { affectedRows?: number } })?.[0]?.affectedRows ?? 0) > 0
}

export async function markAssistantProposalFailed(db: Db, id: string) {
  await db.update(assistantActionProposals).set({ status: 'FAILED' }).where(eq(assistantActionProposals.id, id))
}

export async function cleanupExpiredAssistantData(db: Db, now = new Date()) {
  const proposals = await db.delete(assistantActionProposals).where(lt(assistantActionProposals.expiresAt, now))
  const drafts = await db.delete(assistantDrafts).where(lt(assistantDrafts.expiresAt, now))
  const artifacts = await db.delete(assistantArtifacts).where(lt(assistantArtifacts.expiresAt, now))
  const conversations = await db.delete(assistantConversations).where(lt(assistantConversations.expiresAt, now))
  return { proposals, drafts, artifacts, conversations }
}
