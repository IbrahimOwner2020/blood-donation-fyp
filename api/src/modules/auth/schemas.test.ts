/**
 * Auth Zod schema unit tests (no DB).
 */

import { describe, expect, test } from 'bun:test'

import { changePasswordBodySchema, loginBodySchema } from './schemas'

describe('loginBodySchema', () => {
  test('trims and accepts email/password', () => {
    const parsed = loginBodySchema.parse({
      email: '  user@example.com ',
      password: 'secret',
    })
    expect(parsed.email).toBe('user@example.com')
    expect(parsed.password).toBe('secret')
  })
})

describe('changePasswordBodySchema', () => {
  test('requires new password length >= 8', () => {
    expect(
      changePasswordBodySchema.safeParse({
        currentPassword: 'old-secret',
        newPassword: 'short',
      }).success,
    ).toBe(false)
  })

  test('rejects identical current and new passwords', () => {
    expect(
      changePasswordBodySchema.safeParse({
        currentPassword: 'same-password',
        newPassword: 'same-password',
      }).success,
    ).toBe(false)
  })

  test('accepts a valid password change payload', () => {
    const parsed = changePasswordBodySchema.parse({
      currentPassword: 'old-secret',
      newPassword: 'new-secret-1',
    })
    expect(parsed.currentPassword).toBe('old-secret')
    expect(parsed.newPassword).toBe('new-secret-1')
  })
})
