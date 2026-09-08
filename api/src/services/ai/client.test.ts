import { afterEach, describe, expect, mock, test } from 'bun:test'

import { AppError, ErrorCodes } from '../../lib/errors'
import { resetEnvCache } from '../../lib/env'
import { AiServiceClient, createAiClient } from './client'
import type { AiFetch, ForecastRequest, TrainRequest } from './types'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('AiServiceClient', () => {
  afterEach(() => {
    resetEnvCache()
    mock.restore()
  })

  test('forecast posts history and returns predictions within timeout', async () => {
    const forecastBody: ForecastRequest = {
      blood_group: 'O+',
      facility_id: 'facility-001',
      horizon_days: 7,
      history: [
        { date: '2026-07-01', demand_units: 8 },
        { date: '2026-07-02', demand_units: 5 },
      ],
    }

    let capturedUrl = ''
    let capturedInit: RequestInit | undefined

    const fetchMock = mock<AiFetch>(async (input, init) => {
      capturedUrl = String(input)
      capturedInit = init
      return jsonResponse({
        blood_group: 'O+',
        facility_id: 'facility-001',
        horizon_days: 7,
        model: 'hist_gradient_boosting',
        model_version: '2026-09-01-01',
        predictions: [
          { date: '2026-09-02', units: 7.3 },
          { date: '2026-09-03', units: 6.8 },
        ],
        total_predicted_units: 48.6,
        metrics: { mae: 1.8, rmse: 2.3 },
      })
    })

    const client = new AiServiceClient({
      baseUrl: 'http://ai.test:8000',
      requestTimeoutMs: 30_000,
      fetch: fetchMock,
    })

    const result = await client.forecast(forecastBody)

    expect(capturedUrl).toBe('http://ai.test:8000/forecast')
    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.signal).toBeDefined()
    expect(JSON.parse(String(capturedInit?.body ?? '{}'))).toEqual(forecastBody)
    expect(result.model).toBe('hist_gradient_boosting')
    expect(result.predictions?.[0]?.units).toBe(7.3)
    expect(result.total_predicted_units).toBe(48.6)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('train uses longer train timeout and maps success body', async () => {
    const trainBody: TrainRequest = {
      series: [
        {
          blood_group: 'O+',
          facility_id: 'facility-001',
          date: '2026-01-01',
          demand_units: 10,
        },
      ],
      candidate_models: ['moving_average', 'hist_gradient_boosting'],
    }

    const fetchMock = mock<AiFetch>(async (_input, init) => {
      expect(init?.signal).toBeDefined()
      return jsonResponse({
        selected_model: 'hist_gradient_boosting',
        model_version: '2026-09-01-01',
        metrics: { mae: 1.8, rmse: 2.3 },
        baseline_metrics: { mae: 2.7, rmse: 3.5 },
      })
    })

    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      trainTimeoutMs: 120_000,
      fetch: fetchMock,
    })

    const result = await client.train(trainBody)
    expect(result.selected_model).toBe('hist_gradient_boosting')
    expect(result.baseline_metrics?.mae).toBe(2.7)
  })

  test('listModels and getModelMetrics hit documented paths', async () => {
    const urls: string[] = []
    const fetchMock = mock<AiFetch>(async (input) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/models')) {
        return jsonResponse({
          models: [
            {
              model_id: 'm1',
              model_name: 'hist_gradient_boosting',
              model_version: 'v1',
            },
          ],
        })
      }
      return jsonResponse({
        model_id: 'm1',
        model_name: 'hist_gradient_boosting',
        model_version: 'v1',
        metrics: { mae: 1.1, rmse: 1.4 },
      })
    })

    const client = new AiServiceClient({
      baseUrl: 'http://ai.test/',
      fetch: fetchMock,
    })

    const models = await client.listModels()
    expect(models.models?.[0]?.model_id).toBe('m1')

    const metrics = await client.getModelMetrics('m1')
    expect(metrics.metrics?.mae).toBe(1.1)

    expect(urls).toEqual([
      'http://ai.test/models',
      'http://ai.test/models/m1/metrics',
    ])
  })

  test('chat posts assistant request without browser cookies', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetchMock = mock<AiFetch>(async (input, init) => {
      capturedUrl = String(input)
      capturedInit = init
      return jsonResponse({
        type: 'answer',
        message: 'There are 12 donations in view.',
      })
    })

    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      fetch: fetchMock,
    })
    const result = await client.chat({
      message: 'summarize this page',
      context: { pathname: '/donations' },
      permissions: ['donations:read'],
      toolSessionToken: 'ast_123456789012345678901234',
      toolsUrl: 'http://api.test/api/v1/assistant/tools',
    })

    expect(capturedUrl).toBe('http://ai.test/chat')
    expect(capturedInit?.method).toBe('POST')
    expect((capturedInit?.headers as Record<string, string>)?.Cookie).toBeUndefined()
    expect(JSON.parse(String(capturedInit?.body ?? '{}'))).toMatchObject({
      message: 'summarize this page',
      toolSessionToken: 'ast_123456789012345678901234',
    })
    expect(result.type).toBe('answer')
  })

  test('maps AI error contract into AppError without crashing', async () => {
    const fetchMock = mock<AiFetch>(async () =>
      jsonResponse(
        {
          error: {
            code: 'INSUFFICIENT_HISTORY',
            message: 'At least 30 historical records are required for this model.',
          },
        },
        400,
      ),
    )

    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      fetch: fetchMock,
    })

    try {
      await client.forecast({
        blood_group: 'A+',
        history: [{ date: '2026-07-01', demand_units: 1 }],
      })
      throw new Error('expected AppError')
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true)
      if (!AppError.isAppError(error)) {
        return
      }
      expect(error.code).toBe(ErrorCodes.BAD_REQUEST)
      expect(error.status).toBe(400)
      expect(error.details?.[0]?.code).toBe('INSUFFICIENT_HISTORY')
      expect(error.message).toContain('30 historical')
    }
  })

  test('timeout becomes AppError with AI_TIMEOUT detail', async () => {
    const fetchMock = mock<AiFetch>(async (_input, init) => {
      const signal = init?.signal
      return await new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error('missing abort signal'))
          return
        }
        if (signal.aborted) {
          const abortError = new Error('Aborted')
          abortError.name = 'AbortError'
          reject(abortError)
          return
        }
        signal.addEventListener('abort', () => {
          const abortError = new Error('Aborted')
          abortError.name = 'AbortError'
          reject(abortError)
        })
      })
    })

    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      requestTimeoutMs: 20,
      fetch: fetchMock,
    })

    try {
      await client.forecast({
        blood_group: 'O-',
        history: [{ date: '2026-07-01', demand_units: 2 }],
      })
      throw new Error('expected timeout AppError')
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true)
      if (!AppError.isAppError(error)) {
        return
      }
      expect(error.status).toBe(504)
      expect(error.details?.[0]?.code).toBe('AI_TIMEOUT')
      expect(error.message).toContain('timed out')
    }
  })

  test('network failure maps to AI_SERVICE_UNAVAILABLE AppError', async () => {
    const fetchMock = mock<AiFetch>(async () => {
      throw new TypeError('fetch failed')
    })

    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      fetch: fetchMock,
    })

    try {
      await client.listModels()
      throw new Error('expected unreachable AppError')
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true)
      if (!AppError.isAppError(error)) {
        return
      }
      expect(error.status).toBe(503)
      expect(error.details?.[0]?.code).toBe('AI_SERVICE_UNAVAILABLE')
    }
  })

  test('health returns degraded result instead of throwing', async () => {
    const fetchMock = mock<AiFetch>(async () => {
      throw new TypeError('ECONNREFUSED')
    })

    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      healthTimeoutMs: 50,
      fetch: fetchMock,
    })

    const result = await client.health()
    expect(result.ok).toBe(false)
    expect(result.degraded).toBe(true)
    if (result.ok) {
      return
    }
    expect(result.reason.length).toBeGreaterThan(0)
    expect(result.aiErrorCode).toBe('AI_SERVICE_UNAVAILABLE')
  })

  test('health returns ok payload when AI is healthy', async () => {
    const fetchMock = mock<AiFetch>(async () =>
      jsonResponse({ service: 'ai-service', status: 'ok' }),
    )

    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      fetch: fetchMock,
    })

    const result = await client.health()
    expect(result.ok).toBe(true)
    expect(result.degraded).toBe(false)
    if (!result.ok) {
      return
    }
    expect(result.data.service).toBe('ai-service')
    expect(result.data.status).toBe('ok')
  })

  test('createAiClient reads URL and timeouts from AppEnv', async () => {
    resetEnvCache()
    const client = createAiClient({
      NODE_ENV: 'test',
      API_PORT: 3000,
      SESSION_SECRET: 'test',
      DB_HOST: 'localhost',
      DB_PORT: 3306,
      DB_NAME: 'nbts_blood_ai',
      DB_USER: 'nbts',
      DB_PASSWORD: 'change-me',
      AI_SERVICE_URL: 'http://ai-from-env:8000',
      AI_REQUEST_TIMEOUT_MS: 30_000,
      AI_TRAIN_TIMEOUT_MS: 90_000,
      AI_HEALTH_TIMEOUT_MS: 4_000,
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_FROM: 'no-reply@nbts.local',
      SMS_PROVIDER: 'mock',
      COOKIE_SECURE: false,
      APP_ORIGINS: 'http://localhost:5173,http://localhost:3000',
      LOGIN_RATE_LIMIT_MAX: 5,
      LOGIN_RATE_LIMIT_WINDOW_MS: 900_000,
      OLLAMA_ENABLED: false,
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLLAMA_MODEL: 'phi4',
    })

    expect(client.baseUrl).toBe('http://ai-from-env:8000')
    expect(client.requestTimeoutMs).toBe(30_000)
    expect(client.trainTimeoutMs).toBe(90_000)
    expect(client.healthTimeoutMs).toBe(4_000)
  })

  test('getModelMetrics rejects empty model_id', async () => {
    const client = new AiServiceClient({
      baseUrl: 'http://ai.test',
      fetch: mock(async () => jsonResponse({})),
    })

    try {
      await client.getModelMetrics('  ')
      throw new Error('expected validation AppError')
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true)
      if (!AppError.isAppError(error)) {
        return
      }
      expect(error.code).toBe(ErrorCodes.BAD_REQUEST)
    }
  })
})
