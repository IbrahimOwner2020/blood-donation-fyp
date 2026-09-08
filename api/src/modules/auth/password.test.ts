import { describe, expect, test } from 'bun:test'

import { hashPassword, verifyPassword } from './password'
import { toPublicUser, type UserRow } from './serialize'

describe('hashPassword / verifyPassword (Argon2id via Bun.password)', () => {
  test('hashes with argon2id and verifies matching password', async () => {
    const password = 'Correct-Horse-Battery-Staple!'
    const hash = await hashPassword(password)

    expect(hash).toBeString()
    expect(hash.length).toBeGreaterThan(20)
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(hash).not.toContain(password)

    await expect(verifyPassword(password, hash)).resolves.toBe(true)
  })

  test('rejects wrong password', async () => {
    const hash = await hashPassword('secret-one')
    await expect(verifyPassword('secret-two', hash)).resolves.toBe(false)
  })

  test('returns false for empty / missing inputs without throwing', async () => {
    const hash = await hashPassword('present')
    await expect(verifyPassword('', hash)).resolves.toBe(false)
    await expect(verifyPassword('present', null)).resolves.toBe(false)
    await expect(verifyPassword('present', undefined)).resolves.toBe(false)
    await expect(verifyPassword('present', 'not-a-valid-hash')).resolves.toBe(false)
  })

  test('rejects empty password on hash', async () => {
    await expect(hashPassword('')).rejects.toThrow()
  })
})

describe('toPublicUser', () => {
  test('never includes passwordHash', () => {
    const row: UserRow = {
      id: 1,
      name: 'Officer',
      email: 'officer@nbts.example',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$secret',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    }

    const publicUser = toPublicUser(row)
    expect(publicUser).toEqual({
      id: 1,
      name: 'Officer',
      email: 'officer@nbts.example',
      status: 'ACTIVE',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
    expect(publicUser).not.toHaveProperty('passwordHash')
    expect(JSON.stringify(publicUser)).not.toContain('passwordHash')
    expect(JSON.stringify(publicUser)).not.toContain('$argon2id$')
  })

  test('returns null for missing user', () => {
    expect(toPublicUser(null)).toBeNull()
    expect(toPublicUser(undefined)).toBeNull()
  })
})
