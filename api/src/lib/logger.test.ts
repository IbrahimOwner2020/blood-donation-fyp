import { describe, expect, test } from 'bun:test'

import { redactSensitive } from './logger'

describe('redactSensitive (auth paths)', () => {
  test('redacts password, session, csrf, email, recipient, and to keys', () => {
    const input = {
      email: 'officer@nbts.example',
      password: 'super-secret',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$abc',
      sessionId: 'abc123session',
      csrfToken: 'csrf-value',
      nbts_session: 'cookie-value',
      recipient: '+255712345678',
      to: 'donor@example.com',
      userId: 42,
      nested: {
        authorization: 'Bearer tok',
        cookie: 'nbts_session=xyz',
      },
    }

    const redacted = redactSensitive(input) as Record<string, unknown>
    const nested = redacted.nested as Record<string, unknown>

    expect(redacted.email).toBe('[REDACTED]')
    expect(redacted.password).toBe('[REDACTED]')
    expect(redacted.passwordHash).toBe('[REDACTED]')
    expect(redacted.sessionId).toBe('[REDACTED]')
    expect(redacted.csrfToken).toBe('[REDACTED]')
    expect(redacted.nbts_session).toBe('[REDACTED]')
    expect(redacted.recipient).toBe('[REDACTED]')
    expect(redacted.to).toBe('[REDACTED]')
    expect(redacted.userId).toBe(42)
    expect(nested.authorization).toBe('[REDACTED]')
    expect(nested.cookie).toBe('[REDACTED]')
  })

  test('does not redact non-sensitive auth meta', () => {
    const redacted = redactSensitive({
      message: 'auth.login_failed',
      reason: 'bad_password',
      userId: 7,
    }) as Record<string, unknown>

    expect(redacted.reason).toBe('bad_password')
    expect(redacted.userId).toBe(7)
    expect(redacted.message).toBe('auth.login_failed')
  })
})
