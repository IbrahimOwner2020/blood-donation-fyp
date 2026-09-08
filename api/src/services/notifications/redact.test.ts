import { describe, expect, test } from 'bun:test'
import { redactEmail, redactPhone } from './redact'

describe('redactPhone', () => {
  test('keeps only last four digits', () => {
    expect(redactPhone('+255712345678')).toBe('***5678')
    expect(redactPhone('0712345678')).toBe('***5678')
  })

  test('handles empty and short values', () => {
    expect(redactPhone('')).toBe('***')
    expect(redactPhone(null)).toBe('***')
    expect(redactPhone('12')).toBe('***')
  })
})

describe('redactEmail', () => {
  test('masks local part', () => {
    expect(redactEmail('donor@example.com')).toBe('d***@example.com')
  })

  test('handles empty and invalid values', () => {
    expect(redactEmail('')).toBe('***')
    expect(redactEmail(undefined)).toBe('***')
    expect(redactEmail('not-an-email')).toBe('***')
  })
})
