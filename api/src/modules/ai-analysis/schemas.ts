import { z } from 'zod'

import {
  aiAnalysisNotificationModes,
  aiAnalysisRunTriggers,
} from '../../db/schema/ai-analysis'

export const aiAnalysisNotificationModeSchema = z.enum(
  aiAnalysisNotificationModes,
)
export const aiAnalysisRunTriggerSchema = z.enum(aiAnalysisRunTriggers)

export const aiAnalysisIdParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'AI analysis id must be a number' })
    .int('AI analysis id must be an integer')
    .positive('AI analysis id must be positive'),
})

export type AiAnalysisIdParam = z.infer<typeof aiAnalysisIdParamSchema>

export const runAiAnalysisBodySchema = z
  .object({
    horizonDays: z.coerce
      .number({ invalid_type_error: 'horizonDays must be a number' })
      .int('horizonDays must be an integer')
      .refine((value) => value === 7 || value === 14 || value === 30 || value === 60, {
        message: 'horizonDays must be 7, 14, 30, or 60',
      })
      .optional()
      .default(60),
    notificationMode: aiAnalysisNotificationModeSchema.optional(),
  })
  .strict()

export type RunAiAnalysisBody = z.infer<typeof runAiAnalysisBodySchema>

export const listAiAnalysisQuerySchema = z.object({
  triggerType: aiAnalysisRunTriggerSchema.optional(),
  notificationMode: aiAnalysisNotificationModeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export type ListAiAnalysisQuery = z.infer<typeof listAiAnalysisQuerySchema>

export const patchAiAnalysisSettingsBodySchema = z
  .object({
    notificationMode: aiAnalysisNotificationModeSchema,
  })
  .strict()

export type PatchAiAnalysisSettingsBody = z.infer<
  typeof patchAiAnalysisSettingsBodySchema
>
