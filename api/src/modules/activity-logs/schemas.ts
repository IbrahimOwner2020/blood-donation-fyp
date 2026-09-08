/**
 * Zod schemas for activity log list (docs/06 activity_logs, docs/10 activity:read).
 */

import { z } from 'zod'

/**
 * Accept ISO-8601 datetime query strings → Date.
 * Empty / missing → undefined (filter omitted).
 */
const optionalQueryDateTimeSchema = z.preprocess((raw) => {
  if (raw === undefined || raw === null || raw === '') {
    return undefined
  }
  if (raw instanceof Date) {
    return raw
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return undefined
    }
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) {
      return raw
    }
    return parsed
  }
  return raw
}, z.date({ invalid_type_error: 'Must be a valid ISO-8601 datetime' }).optional())

export const listActivityLogsQuerySchema = z.object({
  userId: z.coerce
    .number({ invalid_type_error: 'userId must be a number' })
    .int('userId must be an integer')
    .positive('userId must be positive')
    .optional(),
  action: z.string().trim().min(1).max(120).optional(),
  entityType: z.string().trim().min(1).max(120).optional(),
  entityId: z.string().trim().min(1).max(64).optional(),
  /** Free-text match against action (substring). */
  q: z.string().trim().min(1).max(120).optional(),
  createdFrom: optionalQueryDateTimeSchema,
  createdTo: optionalQueryDateTimeSchema,
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export type ListActivityLogsQuery = z.infer<typeof listActivityLogsQuerySchema>
