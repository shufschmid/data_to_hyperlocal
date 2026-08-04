import { describe, expect, it } from 'vitest'
import { envFlag, optionalEnv, requireEnv } from './env'

describe('requireEnv', () => {
  it('returns the value', () => {
    expect(requireEnv('TOKEN', { TOKEN: 'abc' })).toBe('abc')
  })

  it('names the missing variable in the error', () => {
    expect(() => requireEnv('ANTHROPIC_API_KEY', {})).toThrow(
      /ANTHROPIC_API_KEY/
    )
  })

  it('treats a blank value as missing', () => {
    expect(() => requireEnv('TOKEN', { TOKEN: '   ' })).toThrow(/TOKEN/)
  })
})

describe('optionalEnv', () => {
  it('falls back when unset or blank', () => {
    expect(optionalEnv('MODEL', 'claude-sonnet-5', {})).toBe('claude-sonnet-5')
    expect(optionalEnv('MODEL', 'claude-sonnet-5', { MODEL: '' })).toBe(
      'claude-sonnet-5'
    )
  })

  it('prefers the configured value', () => {
    expect(
      optionalEnv('MODEL', 'claude-sonnet-5', { MODEL: 'claude-opus-5' })
    ).toBe('claude-opus-5')
  })
})

describe('envFlag', () => {
  it('reads the usual truthy spellings', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(envFlag('DEBUG', false, { DEBUG: value })).toBe(true)
    }
  })

  it('treats anything else as false and honours the fallback', () => {
    expect(envFlag('DEBUG', false, { DEBUG: 'nope' })).toBe(false)
    expect(envFlag('DEBUG', true, {})).toBe(true)
  })
})
