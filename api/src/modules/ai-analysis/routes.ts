/**
 * AI analysis report routes.
 * Mounted under /api/v1/ai-analysis.
 */

import type { Context } from 'hono'
import { Hono } from 'hono'

import { getDb } from '../../db'
import { AppError } from '../../lib/errors'
import { getEnv } from '../../lib/env'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import {
  aiAnalysisIdParamSchema,
  listAiAnalysisQuerySchema,
  patchAiAnalysisSettingsBodySchema,
  runAiAnalysisBodySchema,
} from './schemas'
import {
  getAiAnalysisById,
  getAiAnalysisSettings,
  listAiAnalysisRuns,
  runAiAnalysis,
  updateAiAnalysisSettings,
} from './service'

export const aiAnalysisRoutes = new Hono<AppHonoEnv>()

function clientIp(c: Context<AppHonoEnv>): string | null {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    return first || null
  }
  return c.req.header('x-real-ip')?.trim() || null
}

function assertCronSecret(c: Context<AppHonoEnv>): void {
  const expected = getEnv().AI_ANALYSIS_CRON_SECRET?.trim()
  const header = c.req.header('x-ai-analysis-secret')?.trim()
  const bearer = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!expected) {
    throw AppError.forbidden('AI analysis cron secret is not configured')
  }
  if (header !== expected && bearer !== expected) {
    throw AppError.forbidden('Invalid AI analysis cron secret')
  }
}

/**
 * POST /ai-analysis/scheduled
 * Server-to-server cron entrypoint. No user session required; protected by
 * AI_ANALYSIS_CRON_SECRET via x-ai-analysis-secret or Bearer token.
 */
aiAnalysisRoutes.post('/scheduled', async (c) => {
  assertCronSecret(c)
  const parsed = runAiAnalysisBodySchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    throw AppError.validation('Invalid AI analysis request', parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    })))
  }
  const report = await runAiAnalysis(getDb(), {
    triggerType: 'SCHEDULED',
    horizonDays: parsed.data.horizonDays,
    notificationMode: parsed.data.notificationMode,
    actor: {
      userId: null,
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
    },
  })
  return jsonOk(c, { report }, 201)
})

aiAnalysisRoutes.use('*', requireAuth)

aiAnalysisRoutes.post(
  '/run',
  requirePermission('predictions:run', 'reports:read'),
  async (c) => {
    const body = await parseJsonBody(c, runAiAnalysisBodySchema)
    const actor = c.get('user')
    const report = await runAiAnalysis(getDb(), {
      triggerType: 'USER',
      horizonDays: body.horizonDays,
      notificationMode: body.notificationMode,
      actor: {
        userId: actor?.id ?? null,
        requestId: c.get('requestId') ?? null,
        ipAddress: clientIp(c),
      },
    })
    return jsonOk(c, { report }, 201)
  },
)

aiAnalysisRoutes.get(
  '/',
  requirePermission('reports:read'),
  async (c) => {
    const query = parseQuery(c, listAiAnalysisQuerySchema)
    const result = await listAiAnalysisRuns(getDb(), query)
    return jsonOk(c, {
      reports: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    })
  },
)

aiAnalysisRoutes.get(
  '/settings',
  requirePermission('reports:read'),
  async (c) => {
    const settings = await getAiAnalysisSettings(getDb())
    return jsonOk(c, { settings })
  },
)

aiAnalysisRoutes.patch(
  '/settings',
  requirePermission('predictions:run', 'notifications:send'),
  async (c) => {
    const body = await parseJsonBody(c, patchAiAnalysisSettingsBodySchema)
    const settings = await updateAiAnalysisSettings(
      getDb(),
      body.notificationMode,
      c.get('user')?.id ?? null,
    )
    return jsonOk(c, { settings })
  },
)

aiAnalysisRoutes.get(
  '/:id',
  requirePermission('reports:read'),
  async (c) => {
    const { id } = parseParams(c, aiAnalysisIdParamSchema)
    const report = await getAiAnalysisById(getDb(), id)
    return jsonOk(c, { report })
  },
)
