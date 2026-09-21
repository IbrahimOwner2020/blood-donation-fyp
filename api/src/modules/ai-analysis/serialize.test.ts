import { describe, expect, test } from 'bun:test'

import {
  patchAiAnalysisSettingsBodySchema,
  runAiAnalysisBodySchema,
} from './schemas'
import { toPublicAiAnalysisRun } from './serialize'

describe('ai analysis schemas', () => {
  test('defaults to 60-day horizon', () => {
    const parsed = runAiAnalysisBodySchema.parse({})
    expect(parsed.horizonDays).toBe(60)
  })

  test('accepts notification settings modes', () => {
    expect(
      patchAiAnalysisSettingsBodySchema.parse({
        notificationMode: 'AUTO_SEND',
      }).notificationMode,
    ).toBe('AUTO_SEND')
  })
})

describe('toPublicAiAnalysisRun', () => {
  test('maps persisted report ids and recommendation payload', () => {
    const row = toPublicAiAnalysisRun({
      id: 7,
      triggerType: 'SCHEDULED',
      triggeredByUserId: null,
      status: 'COMPLETED',
      horizonDays: 60,
      riskLevel: 'HIGH',
      notificationMode: 'REQUIRE_APPROVAL',
      conclusion: 'Possible short supply in the next 60 days.',
      predictionIdsJson: [1, 2],
      alertIdsJson: [3],
      recommendationsJson: {
        shortages: [],
        donors: [],
        centres: [],
        notificationIds: [],
        approvalEmailRecipients: ['manager@example.test'],
        failures: [],
      },
      failureDetails: null,
      startedAt: new Date('2026-09-09T00:00:00Z'),
      completedAt: new Date('2026-09-09T00:01:00Z'),
      createdAt: new Date('2026-09-09T00:00:00Z'),
    })

    expect(row?.horizonDays).toBe(60)
    expect(row?.predictionIds).toEqual([1, 2])
    expect(row?.alertIds).toEqual([3])
    expect(row?.recommendations.approvalEmailRecipients).toEqual([
      'manager@example.test',
    ])
  })
})
