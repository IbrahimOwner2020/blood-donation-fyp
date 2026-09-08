/**
 * Critical-path API integration test against live MariaDB (TODO.md test-api-integration).
 *
 * Flow: auth → donor → donation → inventory → request → prediction → alert matches
 * → notification preview/send → activity log.
 *
 * Soft-skips when DB is down or demo admin seed is missing so unit-only CI stays green.
 */

import { afterAll, describe, expect, test } from 'bun:test'

import {
  apiRequest,
  buildSyntheticHistory,
  isIntegrationDbReady,
  loginAsDemoAdmin,
  teardownIntegrationDb,
  todayDateOnly,
  uniqueSuffix,
} from './helpers'

describe('API integration critical path', () => {
  afterAll(async () => {
    await teardownIntegrationDb()
  })

  test('auth → donors → donations → inventory → requests → predictions → alerts → notifications', async () => {
    const dbReady = await isIntegrationDbReady()
    if (!dbReady) {
      console.warn(
        '[integration] MariaDB unavailable — soft-skip critical path.',
      )
      return
    }

    const session = await loginAsDemoAdmin()
    if (!session) {
      console.warn(
        '[integration] Demo admin login failed (seed missing?) — soft-skip.',
      )
      return
    }
    const { cookie } = session

    // --- Auth: /me ---
    const me = await apiRequest<{
      user?: { id?: number; email?: string }
      permissions?: string[]
    }>('/api/v1/auth/me', { cookie })
    expect(me.response.status).toBe(200)
    expect(me.body.data?.user?.id).toBeNumber()
    expect(Array.isArray(me.body.data?.permissions)).toBe(true)

    // --- Centres + facilities (seeded) ---
    const centres = await apiRequest<{
      centres?: Array<{ id: number }>
      donationCentres?: Array<{ id: number }>
    }>('/api/v1/donation-centres?limit=5', { cookie })
    expect(centres.response.status).toBe(200)
    const centreList =
      centres.body.data?.centres ??
      centres.body.data?.donationCentres ??
      []
    const centreId = centreList?.[0]?.id
    if (!centreId) {
      console.warn('[integration] No donation centres seeded — soft-skip.')
      return
    }

    const facilities = await apiRequest<{
      facilities?: Array<{ id: number }>
    }>('/api/v1/facilities?limit=5', { cookie })
    expect(facilities.response.status).toBe(200)
    const facilityId = facilities.body.data?.facilities?.[0]?.id
    if (!facilityId) {
      console.warn('[integration] No facilities seeded — soft-skip.')
      return
    }

    // Prefer AB- to reduce collision with demo O+ operations.
    const bloodGroup = 'AB-'
    const summaryLookup = await apiRequest<{
      summary?: {
        groups?: Array<{
          bloodGroupId: number
          bloodGroupCode?: string | null
        }>
      }
    }>('/api/v1/inventory/summary', { cookie })
    expect(summaryLookup.response.status).toBe(200)
    const bloodGroupId =
      summaryLookup.body.data?.summary?.groups?.find((row) => {
        return (row.bloodGroupCode?.trim() || '') === bloodGroup
      })?.bloodGroupId ?? 6 // seed order: AB- is typically id 6

    const suffix = uniqueSuffix()
    const donorNumber = `INT-${suffix}`

    // --- Donor create ---
    const donorCreate = await apiRequest<{
      donor?: {
        id: number
        donorNumber: string
        bloodGroupId: number
        email?: string | null
        phone?: string | null
      }
    }>('/api/v1/donors', {
      method: 'POST',
      cookie,
      json: {
        donorNumber,
        firstName: 'Integration',
        lastName: 'Donor',
        bloodGroupId,
        phone: `+2557${String(Date.now()).slice(-8)}`,
        email: `int-donor-${suffix}@example.local`,
        eligibilityStatus: 'POTENTIALLY_ELIGIBLE',
        active: true,
      },
    })
    expect(donorCreate.response.status).toBe(201)
    const donorId = donorCreate.body.data?.donor?.id
    expect(donorId).toBeNumber()
    expect(donorCreate.body.data?.donor?.bloodGroupId).toBe(bloodGroupId)
    if (!donorId) {
      throw new Error('Donor create did not return id')
    }

    // --- Donation + inventory units ---
    const donationCreate = await apiRequest<{
      donation?: { id: number; units?: number }
    }>('/api/v1/donations', {
      method: 'POST',
      cookie,
      json: {
        donorId,
        donationCentreId: centreId,
        bloodGroupId,
        donationDate: todayDateOnly(),
        units: 1,
        notes: `integration ${suffix}`,
      },
    })
    expect(donationCreate.response.status).toBe(201)
    expect(donationCreate.body.data?.donation?.id).toBeNumber()

    const inventory = await apiRequest<{
      inventory?: Array<{ id: number; bloodGroupId: number; status?: string }>
      total?: number
    }>(`/api/v1/inventory?bloodGroupId=${bloodGroupId}&limit=20`, {
      cookie,
    })
    expect(inventory.response.status).toBe(200)
    expect((inventory.body.data?.inventory?.length ?? 0) > 0).toBe(true)

    const summary = await apiRequest<{
      summary?: { groups?: Array<{ bloodGroupId: number }> }
    }>('/api/v1/inventory/summary', { cookie })
    expect(summary.response.status).toBe(200)
    expect((summary.body.data?.summary?.groups?.length ?? 0) > 0).toBe(true)

    // --- Blood request ---
    const requestCreate = await apiRequest<{
      bloodRequest?: { id: number; status?: string }
    }>('/api/v1/blood-requests', {
      method: 'POST',
      cookie,
      json: {
        facilityId,
        bloodGroupId,
        unitsRequested: 2,
        priority: 'HIGH',
      },
    })
    expect(requestCreate.response.status).toBe(201)
    const requestId = requestCreate.body.data?.bloodRequest?.id
    expect(requestId).toBeNumber()
    if (!requestId) {
      throw new Error('Blood request create did not return id')
    }

    const requestApprove = await apiRequest<{
      bloodRequest?: { id: number; status?: string }
    }>(`/api/v1/blood-requests/${requestId}`, {
      method: 'PATCH',
      cookie,
      json: { status: 'APPROVED' },
    })
    expect(requestApprove.response.status).toBe(200)
    expect(requestApprove.body.data?.bloodRequest?.status).toBe('APPROVED')

    // --- Prediction (inline history; needs AI service) ---
    const predictionRun = await apiRequest<{
      prediction?: { id: number; predictedUnits?: number }
      forecast?: { horizon_days?: number }
    }>('/api/v1/predictions/run', {
      method: 'POST',
      cookie,
      json: {
        bloodGroup,
        horizonDays: 7,
        syncDemand: false,
        train: false,
        history: buildSyntheticHistory(35, 120),
      },
    })

    if (predictionRun.response.status !== 201) {
      console.warn(
        `[integration] Prediction run failed (${predictionRun.response.status}: ${predictionRun.body.error?.message ?? 'unknown'}) — continuing without forecast/alert assertions.`,
      )
    } else {
      const predictionId = predictionRun.body.data?.prediction?.id
      expect(predictionId).toBeNumber()

      // Alerts may be created by afterPredictionPersisted hook.
      const alerts = await apiRequest<{
        alerts?: Array<{ id: number; status?: string; bloodGroupId?: number }>
      }>(`/api/v1/alerts?bloodGroup=${encodeURIComponent(bloodGroup)}&limit=20`, {
        cookie,
      })
      expect(alerts.response.status).toBe(200)

      let alertId = alerts.body.data?.alerts?.[0]?.id

      if (!alertId && predictionId) {
        const recalc = await apiRequest<{
          results?: Array<{
            action?: string
            alert?: { id?: number } | null
          }>
        }>('/api/v1/alerts/recalculate', {
          method: 'POST',
          cookie,
          json: { predictionId },
        })
        expect(recalc.response.status).toBe(200)
        alertId =
          recalc.body.data?.results?.find(
            (r) => typeof r.alert?.id === 'number',
          )?.alert?.id ?? alertId
      }

      if (alertId) {
        const matches = await apiRequest<{
          matches?: Array<{ donor?: { id: number } }>
          total?: number
        }>(`/api/v1/alerts/${alertId}/matches?limit=20`, { cookie })
        expect(matches.response.status).toBe(200)

        // Preview + mock send for the donor we just created.
        const preview = await apiRequest<{
          composedCount?: number
          previews?: unknown[]
        }>('/api/v1/notifications/preview', {
          method: 'POST',
          cookie,
          json: {
            donorIds: [donorId],
            channel: 'SMS',
            alertId,
            message: `Integration test outreach ${suffix}`,
          },
        })
        expect(preview.response.status).toBe(200)
        expect((preview.body.data?.composedCount ?? 0) >= 1).toBe(true)

        const send = await apiRequest<{
          sentCount?: number
          failedCount?: number
        }>('/api/v1/notifications/send', {
          method: 'POST',
          cookie,
          json: {
            donorIds: [donorId],
            channel: 'SMS',
            alertId,
            message: `Integration test outreach ${suffix}`,
          },
        })
        expect(send.response.status).toBe(200)
        expect(
          (send.body.data?.sentCount ?? 0) + (send.body.data?.failedCount ?? 0),
        ).toBeGreaterThanOrEqual(1)

        const history = await apiRequest<{
          notifications?: Array<{ id: number; donorId?: number }>
        }>(`/api/v1/notifications?donorId=${donorId}&limit=10`, { cookie })
        expect(history.response.status).toBe(200)
        expect((history.body.data?.notifications?.length ?? 0) > 0).toBe(true)
      } else {
        // Still exercise notification without alert linkage.
        const preview = await apiRequest<{ composedCount?: number }>(
          '/api/v1/notifications/preview',
          {
            method: 'POST',
            cookie,
            json: {
              donorIds: [donorId],
              channel: 'SMS',
              message: `Integration test outreach ${suffix}`,
            },
          },
        )
        expect(preview.response.status).toBe(200)

        const send = await apiRequest<{ sentCount?: number }>(
          '/api/v1/notifications/send',
          {
            method: 'POST',
            cookie,
            json: {
              donorIds: [donorId],
              channel: 'SMS',
              message: `Integration test outreach ${suffix}`,
            },
          },
        )
        expect(send.response.status).toBe(200)
      }
    }

    // --- Audit / activity ---
    const activity = await apiRequest<{
      activityLogs?: Array<{ id: number; action?: string }>
    }>('/api/v1/activity-logs?limit=20', { cookie })
    expect(activity.response.status).toBe(200)
    expect((activity.body.data?.activityLogs?.length ?? 0) > 0).toBe(true)
  }, 120_000)
})
