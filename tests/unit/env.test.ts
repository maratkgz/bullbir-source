import { describe, expect, it } from 'vitest'
import { EnvError, parseEnv } from '../../server/env.js'

const PEPPER = Buffer.alloc(32, 7).toString('base64')

const emulatorEnv = (): Record<string, string | undefined> => ({
  FIREBASE_PROJECT_ID: 'demo-bullbir',
  APP_ORIGINS: 'http://localhost:5173',
  AUTH_PEPPER: PEPPER,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
})

const productionEnv = (): Record<string, string | undefined> => ({
  FIREBASE_PROJECT_ID: 'bullbir-prod',
  APP_ORIGINS: 'https://bullbir.app',
  AUTH_PEPPER: PEPPER,
  FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from('{"project_id":"x"}').toString('base64'),
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
  RESEND_API_KEY: 're_test_key',
  MAIL_FROM: 'BullBir <no-reply@bullbir.app>',
  VERCEL_ENV: 'production',
})

function catchEnvError(source: Record<string, string | undefined>): EnvError {
  try {
    parseEnv(source)
  } catch (err) {
    expect(err).toBeInstanceOf(EnvError)
    return err as EnvError
  }
  throw new Error('parseEnv did not throw')
}

describe('parseEnv', () => {
  it('accepts a valid emulator environment', () => {
    const env = parseEnv(emulatorEnv())
    expect(env.mode).toBe('emulator')
    expect(env.FIREBASE_PROJECT_ID).toBe('demo-bullbir')
    expect(env.APP_ORIGINS).toEqual(['http://localhost:5173'])
    expect(env.NODE_ENV).toBe('development')
  })

  it('accepts a valid production environment', () => {
    const env = parseEnv(productionEnv())
    expect(env.mode).toBe('production')
    if (env.mode !== 'production') throw new Error('unreachable')
    expect(env.UPSTASH_REDIS_REST_URL).toBe('https://example.upstash.io')
  })

  it.each(['FIREBASE_SERVICE_ACCOUNT_BASE64', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RESEND_API_KEY', 'MAIL_FROM'])(
    'production mode requires %s',
    (name) => {
      const source = { ...productionEnv(), [name]: undefined }
      expect(catchEnvError(source).message).toContain(name)
    },
  )

  it('rejects a non-URL UPSTASH_REDIS_REST_URL', () => {
    const err = catchEnvError({ ...productionEnv(), UPSTASH_REDIS_REST_URL: 'not a url' })
    expect(err.message).toContain('UPSTASH_REDIS_REST_URL')
  })

  it('requires FIREBASE_PROJECT_ID', () => {
    expect(catchEnvError({ ...emulatorEnv(), FIREBASE_PROJECT_ID: '' }).message).toContain('FIREBASE_PROJECT_ID')
  })

  it.each([
    ['missing', undefined],
    ['too short (16 bytes)', Buffer.alloc(16, 1).toString('base64')],
    ['31 bytes', Buffer.alloc(31, 1).toString('base64')],
    ['empty', ''],
  ])('rejects AUTH_PEPPER that is %s', (_label, value) => {
    expect(catchEnvError({ ...emulatorEnv(), AUTH_PEPPER: value }).message).toContain('AUTH_PEPPER')
  })

  it('normalises APP_ORIGINS to bare origins', () => {
    const env = parseEnv({ ...emulatorEnv(), APP_ORIGINS: ' https://bullbir.app/ , http://localhost:5173 ,,' })
    expect(env.APP_ORIGINS).toEqual(['https://bullbir.app', 'http://localhost:5173'])
  })

  it.each([
    ['a path', 'http://localhost:5173/some/path'],
    ['a query', 'https://bullbir.app/?x=1'],
    ['a non-http scheme', 'javascript:alert(1)'],
    ['credentials', 'https://user:pw@bullbir.app'],
  ])('rejects an APP_ORIGINS entry with %s', (_label, value) => {
    expect(catchEnvError({ ...emulatorEnv(), APP_ORIGINS: value }).message).toContain('APP_ORIGINS')
  })

  it('rejects a non-base64 AUTH_PEPPER even when long enough', () => {
    expect(catchEnvError({ ...emulatorEnv(), AUTH_PEPPER: '!'.repeat(64) }).message).toContain('AUTH_PEPPER')
  })

  it.each([['empty', ''], ['not a URL', 'bullbir.app'], ['missing', undefined]])(
    'rejects APP_ORIGINS that is %s',
    (_label, value) => {
      expect(catchEnvError({ ...emulatorEnv(), APP_ORIGINS: value }).message).toContain('APP_ORIGINS')
    },
  )

  it.each(['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'])(
    'rejects %s together with VERCEL_ENV=production',
    (name) => {
      const source: Record<string, string | undefined> = { ...productionEnv(), [name]: '127.0.0.1:1234' }
      expect(catchEnvError(source).message).toMatch(/emulator/i)
    },
  )

  it('emulator mode requires both emulator hosts', () => {
    const err = catchEnvError({ ...emulatorEnv(), FIREBASE_AUTH_EMULATOR_HOST: undefined })
    expect(err.message).toContain('FIREBASE_AUTH_EMULATOR_HOST')
  })

  it('names invalid variables but never includes their secret values', () => {
    const fakeSecret = 'SUPER-SECRET-zx81-value-do-not-leak'
    const shortPepper = Buffer.from('tiny-pepper-SECRETPEPPER').toString('base64')
    const err = catchEnvError({
      FIREBASE_PROJECT_ID: 'bullbir-prod',
      APP_ORIGINS: 'https://bullbir.app',
      AUTH_PEPPER: shortPepper,
      FIREBASE_SERVICE_ACCOUNT_BASE64: fakeSecret,
      UPSTASH_REDIS_REST_URL: `not-a-url-${fakeSecret}`,
      UPSTASH_REDIS_REST_TOKEN: '',
    })
    expect(err.message).toContain('AUTH_PEPPER')
    expect(err.message).toContain('UPSTASH_REDIS_REST_URL')
    expect(err.message).toContain('UPSTASH_REDIS_REST_TOKEN')
    expect(err.message).not.toContain(fakeSecret)
    expect(err.message).not.toContain(shortPepper)
    expect(err.message).not.toContain('SECRETPEPPER')
    expect(String(err.stack)).not.toContain(fakeSecret)
  })
})
