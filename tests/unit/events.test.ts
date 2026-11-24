import type { IncomingMessage } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EVENT_RETENTION_MS,
  recordEvent,
  sanitizeMeta,
  setEventSinkForTests,
  type SecurityEventDoc,
} from '../../server/auth/events.js'
import { setClockForTests } from '../../server/auth/time.js'
import { captureLogs } from '../../server/log.js'

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0)

function ctx(ua = CHROME_WIN) {
  return { req: { headers: { 'user-agent': ua } } as unknown as IncomingMessage, ipPrefix: '203.0.113.0/24' }
}

let written: SecurityEventDoc[]
let logs: string[]
let restoreLogs: () => void

beforeEach(() => {
  written = []
  logs = []
  setEventSinkForTests(async (doc) => { written.push(doc) })
  setClockForTests(() => NOW)
  restoreLogs = captureLogs((line) => logs.push(line))
})

afterEach(() => {
  setEventSinkForTests(undefined)
  setClockForTests(undefined)
  restoreLogs()
})

describe('recordEvent', () => {
  it('writes the documented shape with a 180-day TTL', async () => {
    await recordEvent(ctx(), { uid: 'u1', type: 'login_success', meta: { method: 'password' } })
    expect(written).toHaveLength(1)
    expect(written[0]).toEqual({
      uid: 'u1',
      type: 'login_success',
      ipPrefix: '203.0.113.0/24',
      device: 'Chrome · Windows',
      at: new Date(NOW),
      expiresAt: new Date(NOW + EVENT_RETENTION_MS),
      meta: { method: 'password' },
    })
  })

  it('omits uid when absent (e.g. failed login on unknown account)', async () => {
    await recordEvent(ctx(), { type: 'login_failure', meta: { reason: 'wrong_credentials' } })
    expect(written[0]).not.toHaveProperty('uid')
  })

  it('never stores the raw User-Agent', async () => {
    await recordEvent(ctx(), { uid: 'u1', type: 'logout' })
    expect(JSON.stringify(written[0])).not.toContain('Mozilla')
  })

  it('drops unknown event types without writing', async () => {
    await recordEvent(ctx(), { uid: 'u1', type: 'hacked' as never })
    expect(written).toHaveLength(0)
    expect(logs.some((l) => l.includes('unknown type'))).toBe(true)
  })

  it('swallows a sink failure and logs an error', async () => {
    setEventSinkForTests(async () => { throw new Error('firestore down') })
    await expect(recordEvent(ctx(), { uid: 'u1', type: 'register' })).resolves.toBeUndefined()
    const line = logs.find((l) => l.includes('security event write failed'))
    expect(line).toBeDefined()
    expect(JSON.parse(line as string).level).toBe('error')
  })

  it('swallows a synchronous throw inside the sink', async () => {
    setEventSinkForTests((() => { throw new Error('sync boom') }) as never)
    await expect(recordEvent(ctx(), { uid: 'u1', type: 'register' })).resolves.toBeUndefined()
  })
})

describe('meta filtering', () => {
  it('keeps allow-listed keys with valid values', () => {
    const out = sanitizeMeta({ method: 'code', provider: 'google', count: 3, retryAfterSec: 900, wasCurrent: true, reason: 'locked' })
    expect(out).toEqual({
      meta: { method: 'code', provider: 'google', count: 3, retryAfterSec: 900, wasCurrent: true, reason: 'locked' },
      dropped: [],
    })
  })

  it('drops unknown keys and invalid values, reporting key names only', () => {
    const out = sanitizeMeta({ email: 'a@b.co', note: 'free text', method: 'carrier-pigeon', count: -1, provider: 'google' })
    expect(out.meta).toEqual({ provider: 'google' })
    expect(out.dropped.sort()).toEqual(['count', 'email', 'method', 'note'])
  })

  it('ignores non-object meta', () => {
    expect(sanitizeMeta('x')).toEqual({ meta: {}, dropped: [] })
    expect(sanitizeMeta([1, 2])).toEqual({ meta: {}, dropped: [] })
    expect(sanitizeMeta(undefined)).toEqual({ meta: {}, dropped: [] })
  })

  it('does not accept prototype keys', () => {
    expect(sanitizeMeta({ toString: 'x', constructor: 'y' }).meta).toEqual({})
  })
})

describe('no secrets reach the journal or the logs', () => {
  const SECRETS = {
    password: 'hunter2-secret',
    token: 'eyJhbGciOiJSUzI1NiJ9abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
    code: '123456',
    email: 'victim@example.com',
    sessionId: '0123456789abcdef0123456789abcdef',
  }

  it('strips secret-bearing meta from the stored doc and the warning log', async () => {
    await recordEvent(ctx(), { uid: 'u1', type: 'password_changed', meta: { ...SECRETS, reason: 'user' } })
    const stored = JSON.stringify(written[0])
    const logged = logs.join('\n')
    for (const value of Object.values(SECRETS)) {
      expect(stored).not.toContain(value)
      expect(logged).not.toContain(value)
    }
    expect(written[0]?.meta).toEqual({ reason: 'user' })
    expect(logs.some((l) => l.includes('meta keys dropped'))).toBe(true)
  })

  it('does not leak meta values into the failure log', async () => {
    setEventSinkForTests(async () => { throw new Error('denied') })
    await recordEvent(ctx(), { uid: 'u1', type: 'login_failure', meta: { ...SECRETS } })
    const logged = logs.join('\n')
    for (const value of Object.values(SECRETS)) expect(logged).not.toContain(value)
  })
})
