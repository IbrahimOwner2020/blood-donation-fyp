/**
 * Prediction routes (TODO.md §7, docs/04 predictions/).
 * Mounted under /api/v1/predictions.
 *
 * Permissions (docs/10):
 * - GET list / latest / :id → predictions:read
 * - POST /run → predictions:run
 *
 * After persist, wires shortage-alerts via afterPredictionPersisted (non-fatal).
 */

import { Hono } from 'hono'

import { getDb } from '../../db'
import { jsonOk } from '../../lib/response'
import type { AppHonoEnv } from '../../lib/types'
import { parseJsonBody, parseParams, parseQuery } from '../../lib/validate'
import { requireAuth } from '../../middleware/require-auth'
import { requirePermission } from '../../middleware/require-permission'
import {
  PredictionAuditActions,
  recordActivity,
} from '../../services/audit'
import { afterPredictionPersisted } from '../alerts/hooks'
import {
  latestPredictionQuerySchema,
  listPredictionsQuerySchema,
  predictionIdParamSchema,
  runPredictionBodySchema,
} from './schemas'
import {
  getLatestPrediction,
  getPredictionById,
  listPredictions,
  runPrediction,
} from './service'

export { PredictionAuditActions }
export type { PredictionAuditAction } from '../../services/audit'

function clientIp(c: {
  req: { header: (name: string) => string | undefined }
}): string | null {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    return first || null
  }
  return c.req.header('x-real-ip')?.trim() || null
}

export const predictionRoutes = new Hono<AppHonoEnv>()

predictionRoutes.use('*', requireAuth)

/**
 * POST /predictions/run
 * Body: bloodGroup|bloodGroupId, facilityId?, horizonDays?, syncDemand?,
 *       train?, candidateModels?, from?, to?, history?
 */
predictionRoutes.post('/run', requirePermission('predictions:run'), async (c) => {
  const body = await parseJsonBody(c, runPredictionBodySchema)
  const actor = c.get('user')
  const result = await runPrediction(getDb(), body, {
    afterPredictionPersisted,
  })

  await recordActivity({
    actorUserId: actor?.id ?? null,
    action: PredictionAuditActions.RUN,
    entityType: 'ai_prediction',
    entityId: result.prediction.id,
    metadata: {
      bloodGroupId: result.prediction.bloodGroupId,
      bloodGroupCode: result.prediction.bloodGroup?.code ?? null,
      facilityId: result.prediction.facilityId,
      horizonDays: result.forecast.horizon_days,
      modelName: result.prediction.modelName,
      modelVersion: result.prediction.modelVersion,
      predictedUnits: result.prediction.predictedUnits,
      forecastStart: result.prediction.forecastStart,
      forecastEnd: result.prediction.forecastEnd,
      syncedDemand: Boolean(result.sync),
      trained: Boolean(result.train),
      syncInserted: result.sync?.inserted ?? null,
      syncUpdated: result.sync?.updated ?? null,
      trainModel: result.train?.selected_model ?? null,
    },
    requestId: c.get('requestId') ?? null,
    ipAddress: clientIp(c),
  })

  return jsonOk(
    c,
    {
      prediction: result.prediction,
      forecast: result.forecast,
      train: result.train,
      sync: result.sync,
    },
    201,
  )
})

/**
 * GET /predictions
 * Query: bloodGroupId? | bloodGroup?, facilityId?, from?, to?, limit?, offset?
 */
predictionRoutes.get('/', requirePermission('predictions:read'), async (c) => {
  const query = parseQuery(c, listPredictionsQuerySchema)
  const result = await listPredictions(getDb(), query)
  return jsonOk(c, {
    predictions: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  })
})

/**
 * GET /predictions/latest
 * Query: bloodGroup|bloodGroupId (required), facilityId?
 * Must be registered before /:id.
 */
predictionRoutes.get(
  '/latest',
  requirePermission('predictions:read'),
  async (c) => {
    const query = parseQuery(c, latestPredictionQuerySchema)
    const prediction = await getLatestPrediction(getDb(), query)
    return jsonOk(c, { prediction })
  },
)

/**
 * GET /predictions/:id
 */
predictionRoutes.get(
  '/:id',
  requirePermission('predictions:read'),
  async (c) => {
    const { id } = parseParams(c, predictionIdParamSchema)
    const prediction = await getPredictionById(getDb(), id)
    return jsonOk(c, { prediction })
  },
)
