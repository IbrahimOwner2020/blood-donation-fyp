/**
 * Notification compose + recipient resolution unit tests (no DB / no network).
 */

import { describe, expect, test } from 'bun:test'

import {
  composeDonorNotificationMessage,
  DEFAULT_EMAIL_SUBJECT,
  resolveRecipientForChannel,
} from './compose'

describe('composeDonorNotificationMessage', () => {
  test('composes default SMS with blood group and severity', () => {
    const result = composeDonorNotificationMessage({
      channel: 'SMS',
      donorFirstName: 'Amina',
      bloodGroupCode: 'O+',
      alertSeverity: 'HIGH',
    })
    expect(result.subject).toBeNull()
    expect(result.body).toContain('Dear Amina')
    expect(result.body).toContain('blood group O+')
    expect(result.body).toContain('priority: HIGH')
    expect(result.body).toContain('donation centre')
  })

  test('composes default EMAIL with subject', () => {
    const result = composeDonorNotificationMessage({
      channel: 'EMAIL',
      donorFirstName: 'Juma',
      bloodGroupCode: 'A-',
    })
    expect(result.subject).toBe(DEFAULT_EMAIL_SUBJECT)
    expect(result.body).toContain('Dear Juma')
    expect(result.body).toContain('blood group A-')
    expect(result.body).toContain('NBTS')
  })

  test('uses custom message and subject when provided', () => {
    const result = composeDonorNotificationMessage({
      channel: 'EMAIL',
      donorFirstName: 'Amina',
      customMessage: 'Custom outreach body',
      customSubject: 'Urgent request',
    })
    expect(result.body).toBe('Custom outreach body')
    expect(result.subject).toBe('Urgent request')
  })

  test('falls back to Donor when first name empty', () => {
    const result = composeDonorNotificationMessage({
      channel: 'SMS',
      donorFirstName: '   ',
    })
    expect(result.body).toContain('Dear Donor')
  })
})

describe('resolveRecipientForChannel', () => {
  test('returns phone for SMS and email for EMAIL', () => {
    expect(
      resolveRecipientForChannel('SMS', {
        phone: '+255712345678',
        email: 'a@example.com',
      }),
    ).toBe('+255712345678')
    expect(
      resolveRecipientForChannel('EMAIL', {
        phone: '+255712345678',
        email: 'a@example.com',
      }),
    ).toBe('a@example.com')
  })

  test('returns null when contact missing for channel', () => {
    expect(
      resolveRecipientForChannel('SMS', { phone: null, email: 'a@example.com' }),
    ).toBeNull()
    expect(
      resolveRecipientForChannel('EMAIL', {
        phone: '+255712345678',
        email: '  ',
      }),
    ).toBeNull()
  })
})
