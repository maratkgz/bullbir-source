// Pure auth building blocks (no emulator): crypto helpers, email normalization, session cookie,
// device label, lock schedule and the password policy (with an injected breach checker).
import type { IncomingMessage } from 'node:http'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hmacHex, newUid, randomId, randomToken, safeEqualHex, sha256Hex, sixDigitCode } from '../../server/auth/crypto.js'
import { emailKey, emailSchema, normalizeEmail } from '../../server/auth/email.js'
import { clearSessionCookie, readSessionToken, SESSION_COOKIE, sessionCookie } from '../../server/auth/cookies.js'
import { deviceLabel } from '../../server/auth/device.js'
import { lockDurationMs } from '../../server/auth/throttle.js'
import {
  assertAcceptablePassword,
  assertPasswordLength,
  hashPassword,
  hibpChecker,
  PASSWORD_MAX,
  PASSWORD_MIN,
  setBreachCheckerForTests,
  verifyPasswordOrDummy,
} from '../../server/auth/password.js'
import { isAppError } from '../../server/errors.js'
import { captureLogs } from '../../server/log.js'

const MINUTE = 60_000
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

function reqWith(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (err) {
    return isAppError(err) ? err.code : `non-app:${String(err)}`
  }
}

function syncErrorCode(fn: () => void): string | undefined {
  try {
    fn()
    return undefined
  } catch (err) {
    return isAppError(err) ? err.code : `non-app:${String(err)}`
  }
}

afterEach(() => {
  setBreachCheckerForTests(undefined)
  vi.unstubAllGlobals()
})

describe('crypto', () => {
  it('randomToken is 32 bytes as 43 base64url chars, and never repeats', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const t = randomToken()
      expect(t).toMatch(TOKEN_SHAPE)
      expect(Buffer.from(t, 'base64url')).toHaveLength(32)
      tokens.add(t)
    }
    expect(tokens.size).toBe(200)
  })

  it('randomId is 32 lowercase hex chars; newUid is 28 alphanumerics', () => {
    expect(randomId()).toMatch(/^[0-9a-f]{32}$/)
    expect(newUid()).toMatch(/^[A-Za-z0-9]{28}$/)
    expect(newUid()).not.toBe(newUid())
  })

  it('sixDigitCode is always exactly 6 digits (leading zeros kept)', () => {
    for (let i = 0; i < 2000; i++) expect(sixDigitCode()).toMatch(/^\d{6}$/)
  })

  it('sixDigitCode is roughly uniform (every first digit, leading zeros happen, few repeats)', () => {
    const N = 20_000
    const firstDigit = new Array<number>(10).fill(0)
    const seen = new Set<string>()
    for (let i = 0; i < N; i++) {
      const c = sixDigitCode()
      firstDigit[Number(c[0])]! += 1
      seen.add(c)
    }
    // Expected 2000 per bucket; ±25% is far outside random noise (σ ≈ 42).
    for (const count of firstDigit) {
      expect(count).toBeGreaterThan(1500)
      expect(count).toBeLessThan(2500)
    }
    // Birthday bound: ~200 collisions expected among 20k draws from 10^6.
    expect(seen.size).toBeGreaterThan(N - 600)
  })

  it('sha256Hex / hmacHex are deterministic hex, and the HMAC depends on the pepper', () => {
    expect(sha256Hex('abc')).toBe(createHash('sha256').update('abc').digest('hex'))
    const p1 = Buffer.alloc(32, 1).toString('base64')
    const p2 = Buffer.alloc(32, 2).toString('base64')
    expect(hmacHex(p1, 'x')).toMatch(/^[0-9a-f]{64}$/)
    expect(hmacHex(p1, 'x')).toBe(hmacHex(p1, 'x'))
    expect(hmacHex(p1, 'x')).not.toBe(hmacHex(p2, 'x'))
    expect(hmacHex(p1, 'x')).not.toBe(hmacHex(p1, 'y'))
  })

  it('safeEqualHex: equal → true; different, different length, empty or non-hex → false', () => {
    const a = sha256Hex('a')
    expect(safeEqualHex(a, a)).toBe(true)
    expect(safeEqualHex(a, a.toUpperCase())).toBe(true) // same bytes
    expect(safeEqualHex(a, sha256Hex('b'))).toBe(false)
    expect(safeEqualHex(a, a.slice(0, 62))).toBe(false)
    expect(safeEqualHex('', '')).toBe(false)
    expect(safeEqualHex('zz', 'zz')).toBe(false)
  })
})

describe('email', () => {
  it('normalizes case, surrounding whitespace and NFKC forms', () => {
    expect(normalizeEmail('  Ann@Mail.COM \n')).toBe('ann@mail.com')
    // Fullwidth letters and the fullwidth @ / dot fold to ASCII under NFKC.
    expect(normalizeEmail('ＡＮＮ＠ｍａｉｌ．ｃｏｍ')).toBe('ann@mail.com')
    expect(normalizeEmail('　ann@mail.com　')).toBe('ann@mail.com')
  })

  it('emailKey is a stable 64-hex key: same for equivalent spellings, different for other addresses', () => {
    const k = emailKey(normalizeEmail('Ann@Mail.com'))
    expect(k).toMatch(/^[0-9a-f]{64}$/)
    expect(emailKey(normalizeEmail(' ann@mail.com'))).toBe(k)
    expect(emailKey(normalizeEmail('ＡＮＮ＠ｍａｉｌ．ｃｏｍ'))).toBe(k)
    expect(emailKey('bob@mail.com')).not.toBe(k)
    expect(k).not.toContain('ann')
  })

  it('emailSchema normalizes then validates', () => {
    expect(emailSchema.parse(' Ann@Mail.com ')).toBe('ann@mail.com')
    expect(emailSchema.safeParse('not-an-email').success).toBe(false)
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@x.co`).success).toBe(false)
  })
})

describe('session cookie', () => {
  const token = randomToken()

  it('reads a well-formed __Host-session among other cookies', () => {
    expect(readSessionToken(reqWith({ cookie: `a=1; ${SESSION_COOKIE}=${token}; b=2` }))).toBe(token)
    expect(readSessionToken(reqWith({ cookie: `${SESSION_COOKIE}=${token}` }))).toBe(token)
  })

  it.each([
    ['no cookie header', undefined],
    ['prefixed lookalike', `x${SESSION_COOKIE}=${token}`],
    ['suffixed lookalike', `${SESSION_COOKIE}2=${token}`],
    ['different case', `__host-session=${token}`],
    ['without __Host- prefix', `session=${token}`],
    ['too short', `${SESSION_COOKIE}=${token.slice(1)}`],
    ['too long', `${SESSION_COOKIE}=${token}A`],
    ['bad characters', `${SESSION_COOKIE}=${token.slice(1)}+`],
    ['quoted', `${SESSION_COOKIE}="${token.slice(2)}"`],
    ['empty', `${SESSION_COOKIE}=`],
  ])('ignores %s', (_label, cookie) => {
    const headers: Record<string, string> = cookie === undefined ? {} : { cookie }
    expect(readSessionToken(reqWith(headers))).toBeUndefined()
  })

  function attrs(setCookie: string): string[] {
    return setCookie.split(';').slice(1).map((s) => s.trim())
  }

  it('Set-Cookie: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age, no Domain', () => {
    const value = sessionCookie(token, 604800)
    expect(value.startsWith(`${SESSION_COOKIE}=${token};`)).toBe(true)
    const a = attrs(value)
    expect(a).toEqual(expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=604800']))
    expect(a.some((x) => /^domain=/i.test(x))).toBe(false)
    expect(a.some((x) => /^expires=/i.test(x))).toBe(false)
  })

  it('clearing cookie keeps the same attributes, empty value and Max-Age=0', () => {
    const value = clearSessionCookie()
    expect(value.startsWith(`${SESSION_COOKIE}=;`)).toBe(true)
    const a = attrs(value)
    expect(a).toEqual(expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0']))
    expect(a.some((x) => /^domain=/i.test(x))).toBe(false)
  })
})

describe('deviceLabel', () => {
  const UA = {
    chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
    firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
    safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  }

  it.each([
    [UA.chromeWin, 'Chrome · Windows'],
    [UA.edgeWin, 'Edge · Windows'],
    [UA.safariIphone, 'Safari · iOS'],
    [UA.chromeAndroid, 'Chrome · Android'],
    [UA.firefoxLinux, 'Firefox · Linux'],
    [UA.safariMac, 'Safari · macOS'],
    ['curl/8.0', 'Unknown device'],
    ['', 'Unknown device'],
  ])('%s → %s', (ua, label) => {
    expect(deviceLabel(reqWith(ua ? { 'user-agent': ua } : {}))).toBe(label)
  })

  it('never echoes the raw User-Agent and ignores anything past 512 chars', () => {
    const label = deviceLabel(reqWith({ 'user-agent': `${'x'.repeat(600)} Firefox/1 Windows` }))
    expect(label).toBe('Unknown device')
  })
})

describe('lockDurationMs', () => {
  it('15 min, then doubling, capped at 24 h', () => {
    expect(lockDurationMs(0)).toBe(15 * MINUTE)
    expect(lockDurationMs(1)).toBe(15 * MINUTE)
    expect(lockDurationMs(2)).toBe(30 * MINUTE)
    expect(lockDurationMs(3)).toBe(60 * MINUTE)
    expect(lockDurationMs(7)).toBe(16 * 60 * MINUTE)
    expect(lockDurationMs(8)).toBe(24 * 60 * MINUTE)
    expect(lockDurationMs(50)).toBe(24 * 60 * MINUTE)
    expect(lockDurationMs(10_000)).toBe(24 * 60 * MINUTE)
  })
})

describe('password policy', () => {
  it(`length must be ${PASSWORD_MIN}..${PASSWORD_MAX}`, () => {
    expect(syncErrorCode(() => assertPasswordLength('a'.repeat(PASSWORD_MIN - 1)))).toBe('weak_password')
    expect(syncErrorCode(() => assertPasswordLength('a'.repeat(PASSWORD_MIN)))).toBeUndefined()
    expect(syncErrorCode(() => assertPasswordLength('a'.repeat(PASSWORD_MAX)))).toBeUndefined()
    expect(syncErrorCode(() => assertPasswordLength('a'.repeat(PASSWORD_MAX + 1)))).toBe('weak_password')
    expect(syncErrorCode(() => assertPasswordLength(''))).toBe('weak_password')
  })

  it('counts code points, not UTF-16 units', () => {
    const emoji = '😀' // 2 UTF-16 units, 1 code point
    expect(syncErrorCode(() => assertPasswordLength(emoji.repeat(5)))).toBe('weak_password') // .length 10
    expect(syncErrorCode(() => assertPasswordLength(emoji.repeat(10)))).toBeUndefined()
    expect(syncErrorCode(() => assertPasswordLength(emoji.repeat(PASSWORD_MAX)))).toBeUndefined() // .length 256
    expect(syncErrorCode(() => assertPasswordLength(emoji.repeat(PASSWORD_MAX + 1)))).toBe('weak_password')
  })

  it('an injected breach checker → breached_password', async () => {
    const seen: string[] = []
    setBreachCheckerForTests(async (p) => { seen.push(p); return p === 'password1234' })
    expect(await errorCode(assertAcceptablePassword('password1234'))).toBe('breached_password')
    expect(await errorCode(assertAcceptablePassword('correct horse battery'))).toBeUndefined()
    expect(seen).toEqual(['password1234', 'correct horse battery'])
  })

  it('length is checked before (and without) the breach lookup', async () => {
    const checker = vi.fn(async () => true)
    setBreachCheckerForTests(checker)
    expect(await errorCode(assertAcceptablePassword('short'))).toBe('weak_password')
    expect(checker).not.toHaveBeenCalled()
  })

  it('HIBP lookup sends only a 5-char SHA-1 prefix and matches the suffix (fetch stubbed)', async () => {
    const pw = 'hunter2hunter2'
    const sha1 = createHash('sha1').update(pw).digest('hex').toUpperCase()
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url))
      return new Response(`0000000000000000000000000000000000A:0\r\n${sha1.slice(5)}:42\r\n`, { status: 200 })
    }))
    expect(await hibpChecker(pw)).toBe(true)
    expect(urls).toEqual([`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`])
    expect(urls[0]).not.toContain(sha1.slice(5))
    expect(await hibpChecker('something else entirely')).toBe(false)
  })

  it('HIBP padding entries (count 0) do not count as breached', async () => {
    const pw = 'padding-only-pass'
    const sha1 = createHash('sha1').update(pw).digest('hex').toUpperCase()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`${sha1.slice(5)}:0\n`, { status: 200 })))
    expect(await hibpChecker(pw)).toBe(false)
  })

  it('HIBP unreachable → fails open (allowed) and logs a warning without the password', async () => {
    const lines: string[] = []
    const restore = captureLogs((l) => lines.push(l))
    try {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
      expect(await hibpChecker('my secret password 1')).toBe(false)
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
      expect(await hibpChecker('my secret password 1')).toBe(false)
    } finally {
      restore()
    }
    expect(lines.length).toBe(2)
    expect(lines.join('\n')).not.toContain('my secret password 1')
  })

  it('argon2 hash verifies the right password only; no stored hash → false (dummy work)', async () => {
    const stored = await hashPassword('right password 123')
    expect(stored.startsWith('$argon2id$')).toBe(true)
    expect(stored).not.toContain('right password')
    expect(await verifyPasswordOrDummy(stored, 'right password 123')).toBe(true)
    expect(await verifyPasswordOrDummy(stored, 'wrong password 123')).toBe(false)
    expect(await verifyPasswordOrDummy(null, 'right password 123')).toBe(false)
    expect(await verifyPasswordOrDummy(undefined, '')).toBe(false)
  })
})
