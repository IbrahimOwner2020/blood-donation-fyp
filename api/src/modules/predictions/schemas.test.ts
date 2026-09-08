/**
 * Prediction schema + serialize unit tests (no DB / no network).
 */

import { describe, expect, test } from 'bun:test'

import {
  latestPredictionQuerySchema,
  listPredictionsQuerySchema,
  predictionIdParamSchema,
  runPredictionBodySchema,
} from './schemas'
import {
  buildMetricsJson,
  toDateOnlyString,
  toPredictedUnitsNumber,
  toPublicPrediction,
} from './serialize'

describe('predictionIdParamSchema', () => {
  test('coerces positive integer ids', () => {
    expect(predictionIdParamSchema.parse({ id: '12' })).toEqual({ id: 12 })
  })

  test('rejects non-positive ids', () => {
    expect(predictionIdParamSchema.safeParse({ id: '0' }).success).toBe(false)
  })
})

describe('runPredictionBodySchema', () => {
  test('defaults horizonDays, syncDemand, and train', () => {
    const parsed = runPredictionBodySchema.parse({ bloodGroup: 'O+' })
    expect(parsed.bloodGroup).toBe('O+')
    expect(parsed.horizonDays).toBe(7)
    expect(parsed.syncDemand).toBe(false)
    expect(parsed.train).toBe(false)
    expect(parsed.preferredModel).toBeUndefined()
  })

  test('accepts inline history and horizon 14', () => {
    const parsed = runPredictionBodySchema.parse({
      bloodGroup: 'A-',
      horizonDays: 14,
      history: [
        { date: '2026-07-01', demand_units: 8 },
        { date: '2026-07-02', demand_units: 5 },
      ],
    })
    expect(parsed.horizonDays).toBe(14)
    expect(parsed.history?.[0]?.demand_units).toBe(8)
  })

  test('accepts preferredModel llm and coerces null to undefined', () => {
    const withLlm = runPredictionBodySchema.parse({
      bloodGroup: 'O+',
      preferredModel: 'llm',
    })
    expect(withLlm.preferredModel).toBe('llm')

    const withNull = runPredictionBodySchema.parse({
      bloodGroup: 'O+',
      preferredModel: null,
    })
    expect(withNull.preferredModel).toBeUndefined()
  })

  test('rejects unknown preferredModel', () => {
    expect(
      runPredictionBodySchema.safeParse({
        bloodGroup: 'O+',
        preferredModel: 'not-a-model',
      }).success,
    ).toBe(false)
  })

  test('rejects candidateModels without train', () => {
    expect(
      runPredictionBodySchema.safeParse({
        bloodGroup: 'O+',
        candidateModels: ['moving_average'],
      }).success,
    ).toBe(false)
  })

  test('requires blood group', () => {
    expect(runPredictionBodySchema.safeParse({}).success).toBe(false)
  })

  test('rejects both bloodGroupId and bloodGroup', () => {
    expect(
      runPredictionBodySchema.safeParse({
        bloodGroupId: 1,
        bloodGroup: 'O+',
      }).success,
    ).toBe(false)
  })
})

describe('latestPredictionQuerySchema', () => {
  test('requires blood group filter', () => {
    expect(latestPredictionQuerySchema.safeParse({}).success).toBe(false)
    expect(
      latestPredictionQuerySchema.parse({ bloodGroup: 'B+' }),
    ).toEqual({ bloodGroup: 'B+' })
  })
})

describe('listPredictionsQuerySchema', () => {
  test('defaults pagination', () => {
    const parsed = listPredictionsQuerySchema.parse({})
    expect(parsed.limit).toBe(100)
    expect(parsed.offset).toBe(0)
  })
})

describe('serialize helpers', () => {
  test('toDateOnlyString and toPredictedUnitsNumber', () => {
    expect(toDateOnlyString('2026-09-02T00:00:00.000Z')).toBe('2026-09-02')
    expect(toPredictedUnitsNumber('48.60')).toBe(48.6)
    expect(toPredictedUnitsNumber(12)).toBe(12)
  })

  test('toPublicPrediction maps metrics series', () => {
    const metrics = buildMetricsJson({
      mae: 1.8,
      rmse: 2.3,
      wape: null,
      horizonDays: 7,
      predictions: [
        { date: '2026-09-02', units: 7.3 },
        { date: '2026-09-03', units: 6.8 },
      ],
      train: null,
    })

    const publicPrediction = toPublicPrediction(
      {
        id: 9,
        bloodGroupId: 1,
        facilityId: null,
        forecastStart: '2026-09-02',
        forecastEnd: '2026-09-03',
        predictedUnits: '14.10',
        modelName: 'hist_gradient_boosting',
        modelVersion: '2026-09-01-01',
        metricsJson: metrics,
        createdAt: new Date('2026-09-02T12:00:00.000Z'),
      },
      {
        bloodGroup: { id: 1, code: 'O+', abo: 'O', rh: '+' },
      },
    )

    expect(publicPrediction?.series).toHaveLength(2)
    expect(publicPrediction?.predictedUnits).toBe(14.1)
    expect(publicPrediction?.bloodGroup?.code).toBe('O+')
    expect(publicPrediction?.metrics?.horizon_days).toBe(7)
  })
})
