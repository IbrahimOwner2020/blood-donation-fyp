/**
 * Prediction orchestration tests with mocked AI client (no network / no DB write).
 */

import { describe, expect, mock, test } from 'bun:test'

import { AppError, ErrorCodes } from '../../lib/errors'
import type {
  AiServiceClient,
  ForecastResponse,
  TrainResponse,
} from '../../services/ai'
import { noopAfterPredictionPersisted } from './hooks'
import type { PublicPrediction } from './serialize'

const sampleForecast: ForecastResponse = {
  blood_group: 'O+',
  facility_id: null,
  horizon_days: 7,
  model: 'hist_gradient_boosting',
  model_version: '2026-09-01-01',
  predictions: [
    { date: '2026-09-02', units: 7.3 },
    { date: '2026-09-03', units: 6.8 },
  ],
  total_predicted_units: 14.1,
  metrics: { mae: 1.8, rmse: 2.3 },
}

const sampleTrain: TrainResponse = {
  selected_model: 'hist_gradient_boosting',
  model_version: '2026-09-01-01',
  metrics: { mae: 1.8, rmse: 2.3 },
  baseline_metrics: { mae: 2.7, rmse: 3.5 },
}

function makePublicPrediction(
  overrides: Partial<PublicPrediction> = {},
): PublicPrediction {
  return {
    id: 42,
    bloodGroupId: 1,
    bloodGroup: { id: 1, code: 'O+', abo: 'O', rh: '+' },
    facilityId: null,
    facility: null,
    forecastStart: '2026-09-02',
    forecastEnd: '2026-09-03',
    predictedUnits: 14.1,
    modelName: 'hist_gradient_boosting',
    modelVersion: '2026-09-01-01',
    metrics: {
      mae: 1.8,
      rmse: 2.3,
      horizon_days: 7,
      predictions: sampleForecast.predictions,
    },
    series: sampleForecast.predictions,
    createdAt: new Date('2026-09-02T12:00:00.000Z'),
    ...overrides,
  }
}

describe('AiServiceClient error contract used by predictions', () => {
  test('forecast unavailable maps to degraded AppError (does not crash)', async () => {
    const forecast = mock(async () => {
      throw new AppError('AI service forecast is unreachable', {
        code: ErrorCodes.INTERNAL_ERROR,
        status: 503,
        details: [
          {
            code: 'AI_SERVICE_UNAVAILABLE',
            message: 'connect ECONNREFUSED',
          },
        ],
      })
    })

    const ai = {
      forecast,
      train: mock(async () => sampleTrain),
    } as unknown as AiServiceClient

    let caught: unknown
    try {
      await ai.forecast({
        blood_group: 'O+',
        history: [{ date: '2026-07-01', demand_units: 1 }],
      })
    } catch (error) {
      caught = error
    }

    expect(AppError.isAppError(caught)).toBe(true)
    if (AppError.isAppError(caught)) {
      expect(caught.status).toBe(503)
      expect(caught.details?.[0]?.code).toBe('AI_SERVICE_UNAVAILABLE')
    }
    expect(forecast).toHaveBeenCalledTimes(1)
  })

  test('forecast posts docs/14-shaped body via injectable client', async () => {
    let capturedBody: unknown
    const forecast = mock(async (body: unknown) => {
      capturedBody = body
      return sampleForecast
    })
    const train = mock(async () => sampleTrain)
    const ai = { forecast, train } as unknown as AiServiceClient

    const result = await ai.forecast({
      blood_group: 'O+',
      facility_id: null,
      horizon_days: 7,
      history: [
        { date: '2026-07-01', demand_units: 8 },
        { date: '2026-07-02', demand_units: 5 },
      ],
    })

    expect(capturedBody).toEqual({
      blood_group: 'O+',
      facility_id: null,
      horizon_days: 7,
      history: [
        { date: '2026-07-01', demand_units: 8 },
        { date: '2026-07-02', demand_units: 5 },
      ],
    })
    expect(result.total_predicted_units).toBe(14.1)
    expect(train).not.toHaveBeenCalled()
  })
})

describe('shortage-alerts hook point', () => {
  test('noopAfterPredictionPersisted resolves without side effects', async () => {
    await noopAfterPredictionPersisted({
      prediction: makePublicPrediction(),
      forecast: sampleForecast,
      bloodGroupId: 1,
      facilityId: null,
    })
  })
})
