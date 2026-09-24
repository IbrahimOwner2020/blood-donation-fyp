/**
 * App assistant request contracts.
 * Natural-language parsing is intentionally bounded; execution remains API-owned.
 */

import { z } from 'zod'

const contextSchema = z
  .object({
    pathname: z.string().trim().max(300).optional(),
    search: z.string().trim().max(800).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .optional()

export const assistantMessageBodySchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, 'message is required')
      .max(2000, 'message must be at most 2000 characters'),
    context: contextSchema,
    history: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().trim().min(1).max(2000),
    })).max(10).optional().default([]),
  })
  .strict()

export type AssistantMessageBody = z.infer<typeof assistantMessageBodySchema>

export const assistantActionParamSchema = z.object({
  id: z.string().trim().min(12, 'Action id is invalid').max(120),
})

export type AssistantActionParam = z.infer<typeof assistantActionParamSchema>

const permissionCodeSchema = z.string().trim().min(1).max(80)

export const assistantActionProposalSchema = z.object({
  id: z.string().trim().min(12).max(120),
  action: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1000),
  requiredPermission: permissionCodeSchema,
  payload: z.record(z.string(), z.unknown()),
  effect: z.string().trim().min(1).max(1000),
})

export const assistantResultSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('answer'),
    message: z.string().trim().min(1).max(4000),
  }),
  z.object({
    type: z.literal('navigation'),
    message: z.string().trim().min(1).max(1000),
    path: z.string().trim().min(1).max(300),
    requiredPermission: permissionCodeSchema.optional(),
  }),
  z.object({
    type: z.literal('permission_denied'),
    message: z.string().trim().min(1).max(1000),
    requiredPermission: permissionCodeSchema,
  }),
  z.object({
    type: z.literal('action_proposal'),
    message: z.string().trim().min(1).max(1000),
    proposal: assistantActionProposalSchema,
  }),
])

export type AssistantResultBody = z.infer<typeof assistantResultSchema>

export const assistantChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  context: contextSchema,
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000) })).max(10).optional().default([]),
  permissions: z.array(permissionCodeSchema).max(100),
  toolSessionToken: z.string().trim().min(24).max(160),
  toolsUrl: z.string().url(),
})

export type AssistantChatRequest = z.infer<typeof assistantChatRequestSchema>

export const assistantToolListResponseSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(1000),
      requiredPermission: permissionCodeSchema.optional(),
      mutates: z.boolean(),
      inputSchema: z.record(z.string(), z.unknown()),
    }),
  ),
})

export const assistantToolCallBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  arguments: z.record(z.string(), z.unknown()).optional().default({}),
})

export type AssistantToolCallBody = z.infer<typeof assistantToolCallBodySchema>
