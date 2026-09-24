import { z } from 'zod'

export const publicChatMessageSchema = z.object({
  message: z.string().trim().min(1).max(500),
  language: z.enum(['en', 'sw']).optional(),
  turns: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(4500),
  })).max(6).optional().default([]),
}).strict()

export type PublicChatMessage = z.infer<typeof publicChatMessageSchema>

export const publicChatToolCallSchema = z.object({
  name: z.string().trim().min(1).max(120),
  arguments: z.record(z.string(), z.unknown()).optional().default({}),
}).strict()

export type PublicChatToolCall = z.infer<typeof publicChatToolCallSchema>
