import { afterEach, describe, expect, it } from 'vitest'
import { captureLogs, log, redact } from '../../server/log.js'

const LONG_TOKEN = 'eyJhbGciOiJSUzI1NiJ9abcdefghijklmnopqrstuvwxyz0123456789ABCDEF'

describe('redact', () => {
  it.each(['password', 'newPassword', 'token', 'idToken', 'sessionId', 'code', 'cookie', 'authorization', 'Authorization', 'pepper', 'secret', 'otp', 'apiKey', 'privateKey', 'passwordHash', 'salt'])(
    'masks the value under sensitive key "%s"',
    (key) => {
      const out = redact({ [key]: 'hunter2-value' }) as Record<string, unknown>
      expect(out[key]).toBe('[redacted]')
    },
  )

  it('keeps ordinary fields', () => {
    expect(redact({ status: 200, path: 'health', ok: true, missing: null })).toEqual({
      status: 200,
      path: 'health',
      ok: true,
      missing: null,
    })
  })

  it('masks sensitive keys in nested objects and arrays', () => {
    const out = redact({
      user: { profile: { password: 'p@ss-nested' }, sessions: ['s1'] },
      items: [{ token: 'tok-in-array' }, { name: 'ok' }],
    })
    const text = JSON.stringify(out)
    expect(text).not.toContain('p@ss-nested')
    expect(text).not.toContain('tok-in-array')
    expect(text).not.toContain('s1')
    expect(out).toEqual({
      user: { profile: { password: '[redacted]' }, sessions: '[redacted]' },
      items: [{ token: '[redacted]' }, { name: 'ok' }],
    })
  })

  it('masks e-mail addresses inside strings', () => {
    const out = redact('login failed for alice.smith@example.com today') as string
    expect(out).not.toContain('alice.smith@')
    expect(out).toContain('a***@example.com')
  })

  it('truncates long opaque tokens', () => {
    const out = redact(`Bearer ${LONG_TOKEN}`) as string
    expect(out).not.toContain(LONG_TOKEN)
    expect(out).toContain(LONG_TOKEN.slice(0, 6))
    expect(out).toContain(`[${LONG_TOKEN.length}]`)
  })

  it('scrubs Error objects (message and stack)', () => {
    const err = new Error(`cannot verify ${LONG_TOKEN} for bob@example.org`)
    const out = redact(err) as { name: string; message: string; stack?: string }
    expect(out.name).toBe('Error')
    expect(out.message).not.toContain(LONG_TOKEN)
    expect(out.message).not.toContain('bob@')
    expect(String(out.stack)).not.toContain(LONG_TOKEN)
    expect(String(out.stack)).not.toContain('bob@')
  })

  it('does not recurse forever on deep objects', () => {
    let deep: Record<string, unknown> = { leaf: 'x' }
    for (let i = 0; i < 20; i++) deep = { next: deep }
    expect(JSON.stringify(redact(deep))).toContain('[depth]')
  })

  it('does not mutate its input', () => {
    const input = { password: 'p', nested: { token: 't' } }
    redact(input)
    expect(input).toEqual({ password: 'p', nested: { token: 't' } })
  })
})

describe('log + captureLogs', () => {
  let restore: (() => void) | undefined
  afterEach(() => restore?.())

  it('never writes secrets into the log line', () => {
    const lines: string[] = []
    restore = captureLogs((line) => lines.push(line))

    log.info(`user carol@example.net used ${LONG_TOKEN}`, {
      password: 'PLAINTEXT-PASSWORD-1',
      sessionId: 'SESSION-ID-SECRET-2',
      headers: { cookie: 'bb_session=COOKIE-SECRET-3', authorization: 'Bearer AUTH-SECRET-4' },
      code: '123456',
      email: 'carol@example.net',
      err: new Error(`boom ${LONG_TOKEN}`),
      status: 401,
    })

    expect(lines).toHaveLength(1)
    const line = lines[0] as string
    for (const secret of ['PLAINTEXT-PASSWORD-1', 'SESSION-ID-SECRET-2', 'COOKIE-SECRET-3', 'AUTH-SECRET-4', '123456', LONG_TOKEN, 'carol@']) {
      expect(line).not.toContain(secret)
    }
    const entry = JSON.parse(line) as Record<string, unknown>
    expect(entry.level).toBe('info')
    expect(entry.status).toBe(401)
    expect(typeof entry.time).toBe('string')
  })

  it('restore stops capturing', () => {
    const lines: string[] = []
    const stop = captureLogs((line) => lines.push(line))
    log.warn('first')
    stop()
    restore = captureLogs(() => {})
    log.warn('second')
    expect(lines).toHaveLength(1)
  })
})
