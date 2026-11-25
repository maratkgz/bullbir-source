// Unit tests for the code-login routes (stage 4). Storage, sessions and mail are mocked; the real
// zod schemas, email normalisation, cookie helpers and rate limiter run. End-to-end checks live in
// tests/emulator/otp-login.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../server/errors.js'
import type { ApiRequest } from '../../server/http.js'
import { LIMITS } from '../../server/limits.js'
import { MemoryRateLimiter } from '../../server/rateLimit.js'
import type { RequestContext } from '../../server/router.js'
import type { AuthUser } from '../../server/auth/users.js'

const m = vi.hoisted(() => ({
  issueCode: vi.fn(),
  consumeCode: vi.fn(),
  findUserByEmail: vi.fn(),
  getUser: vi.fn(),
  claimUnverifiedAccount: vi.fn(),
  recordLogin: vi.fn(),
  createSession: vi.fn(),
  revokeAllSessions: vi.fn(),
  liftLock: vi.fn(),
  send: vi.fn(),
}))

vi.mock('../../server/auth/otp.js', () => ({ issueCode: m.issueCode, consumeCode: m.consumeCode, CODE_TTL_MS: 600_000 }))
vi.mock('../../server/auth/sessions.js', () => ({
  createSession: m.createSession,
  revokeAllSessions: m.revokeAllSessions,
  deleteSessionByToken: vi.fn(async () => null),
  requireSession: vi.fn(),
  revokeFirebaseTokens: vi.fn(),
}))
vi.mock('../../server/auth/throttle.js', () => ({
  clearFailures: vi.fn(async () => undefined),
  reserveAttempt: vi.fn(),
  liftLock: m.liftLock,
}))
vi.mock('../../server/auth/mailer.js', () => ({ mailer: () => ({ send: m.send }) }))
vi.mock('../../server/auth/users.js', () => ({
  findUserByEmail: m.findUserByEmail,
  getUser: m.getUser,
  claimUnverifiedAccount: m.claimUnverifiedAccount,
  recordLogin: m.recordLogin,
  createVerifiedUser: vi.fn(),
  isAddressTaken: vi.fn(),
  publicUser: (u: AuthUser) => ({ uid: u.uid, email: u.email, emailVerified: u.emailVerified }),
}))

const { requestLoginCode, verifyLoginCode, LOGIN_CODE_DIGITS } = await import('../../server/routes/otpLogin.js')
const { emailKey } = await import('../../server/auth/email.js')
const { sha256Hex } = await import('../../server/auth/crypto.js')
const { captureLogs } = await import('../../server/log.js')
const { setMinResponseMsForTests } = await import('../../server/auth/pacing.js')
setMinResponseMsForTests(0)

const EMAIL = 'ann@mail.com'
const CODE = '12345678'
const CHALLENGE = 'A'.repeat(43) // shape of a 32-byte base64url token
const SESSION_COOKIE = '__Host-session=abc; HttpOnly; Secure; SameSite=Lax; Path=/'
const CODE_SENT_BODY = { status: 'code_sent' }
const OTP_SET_COOKIE = /^__Host-otp=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=600$/

function user(over: Partial<AuthUser> = {}): AuthUser {
  return {
    uid: 'u1',
    email: EMAIL,
    emailVerified: true,
    passwordHash: null,
    displayName: null,
    providers: ['password'],
    status: 'active',
    legacyPassword: null,
    passwordChangedAt: null,
    createdAt: null,
    lastLoginAt: null,
    ...over,
  }
}

type CtxOptions = { limiter?: MemoryRateLimiter; ipKey?: string; otp?: string | null }

function ctx(body: unknown, opts: CtxOptions = {}): RequestContext {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0' }
  const otp = opts.otp === undefined ? CHALLENGE : opts.otp
  if (otp !== null) headers.cookie = `__Host-otp=${otp}`
  const req = { method: 'POST', url: '/', headers, body } as unknown as ApiRequest
  return {
    req,
    env: {} as RequestContext['env'],
    ipKey: opts.ipKey ?? '198.51.100.10',
    ipPrefix: '198.51.100.0/24',
    limiter: opts.limiter ?? new MemoryRateLimiter(),
    requestId: 'r1',
    params: {},
  }
}

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    if (err instanceof AppError) return err.code
    throw err
  }
  throw new Error('expected an AppError')
}

function setCookieOf(res: { headers?: Record<string, string | string[]> }): string[] {
  return [res.headers?.['Set-Cookie'] ?? []].flat()
}

beforeEach(() => {
  vi.clearAllMocks()
  m.issueCode.mockResolvedValue(CODE)
  m.createSession.mockResolvedValue(SESSION_COOKIE)
  m.send.mockResolvedValue(undefined)
  m.liftLock.mockResolvedValue(undefined)
})

describe('POST otp/request', () => {
  it('declares the per-IP code-request limit', () => {
    expect(requestLoginCode.ipLimits).toEqual([LIMITS.codeRequestPerIp])
  })

  it('issues an 8-digit code bound to a fresh challenge cookie and mails it with device + time', async () => {
    m.findUserByEmail.mockResolvedValue(user())
    const res = await requestLoginCode.handler(ctx({ email: '  Ann@Mail.COM ' }))
    expect(res.status).toBe(202)
    expect(res.body).toEqual(CODE_SENT_BODY)
    const [cookie] = setCookieOf(res)
    expect(cookie).toMatch(OTP_SET_COOKIE)
    const challenge = /^__Host-otp=([^;]+)/.exec(cookie as string)?.[1] as string
    expect(challenge).not.toBe(CHALLENGE) // never reuses what the browser presented
    expect(m.findUserByEmail).toHaveBeenCalledWith(EMAIL)
    expect(m.issueCode).toHaveBeenCalledWith('login', emailKey(EMAIL), { uid: 'u1' }, { challenge: sha256Hex(challenge), digits: LOGIN_CODE_DIGITS })
    expect(LOGIN_CODE_DIGITS).toBe(8)
    expect(m.send).toHaveBeenCalledWith({
      kind: 'login-code', to: EMAIL, code: CODE, device: expect.any(String), at: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d$/),
    })
  })

  it('answers identically (incl. the challenge cookie) and sends nothing when no account exists', async () => {
    m.findUserByEmail.mockResolvedValue(null)
    const res = await requestLoginCode.handler(ctx({ email: EMAIL }))
    expect(res.status).toBe(202)
    expect(res.body).toEqual(CODE_SENT_BODY)
    expect(setCookieOf(res)[0]).toMatch(OTP_SET_COOKIE)
    expect(m.issueCode).not.toHaveBeenCalled()
    expect(m.send).not.toHaveBeenCalled()
  })

  it('a disabled account gets the same answer and no code', async () => {
    m.findUserByEmail.mockResolvedValue(user({ status: 'disabled' }))
    const res = await requestLoginCode.handler(ctx({ email: EMAIL }))
    expect(res.status).toBe(202)
    expect(setCookieOf(res)[0]).toMatch(OTP_SET_COOKIE)
    expect(m.issueCode).not.toHaveBeenCalled()
  })

  it('a mail failure still answers 202 (no "account exists" oracle) and logs no code', async () => {
    m.findUserByEmail.mockResolvedValue(user())
    m.send.mockRejectedValue(new AppError('service_unavailable', 'Mail service unavailable'))
    const lines: string[] = []
    const restore = captureLogs((l) => lines.push(l))
    let res
    try {
      res = await requestLoginCode.handler(ctx({ email: EMAIL }))
    } finally {
      restore()
    }
    expect(res.status).toBe(202)
    expect(res.body).toEqual(CODE_SENT_BODY)
    expect(lines.join('\n')).not.toContain(CODE)
  })

  it('cooldown: a second request from the same address+IP within 60 s → rate_limited', async () => {
    m.findUserByEmail.mockResolvedValue(user())
    const limiter = new MemoryRateLimiter()
    await requestLoginCode.handler(ctx({ email: EMAIL }, { limiter }))
    expect(await errorCode(requestLoginCode.handler(ctx({ email: EMAIL }, { limiter })))).toBe('rate_limited')
    // Another IP is not affected by this browser's cooldown.
    await requestLoginCode.handler(ctx({ email: EMAIL }, { limiter, ipKey: '203.0.113.7' }))
    expect(m.issueCode).toHaveBeenCalledTimes(2)
  })

  it('per address+IP: 3 per 15 min (after the cooldown passes)', async () => {
    m.findUserByEmail.mockResolvedValue(user())
    let t = Date.now()
    const limiter = new MemoryRateLimiter(() => t)
    for (let i = 0; i < LIMITS.otpRequestPerEmailIp.limit; i++) {
      await requestLoginCode.handler(ctx({ email: EMAIL }, { limiter }))
      t += 61_000
    }
    expect(await errorCode(requestLoginCode.handler(ctx({ email: EMAIL }, { limiter })))).toBe('rate_limited')
    expect(m.issueCode).toHaveBeenCalledTimes(LIMITS.otpRequestPerEmailIp.limit)
  })

  it('per address overall: 10 per hour across IPs', async () => {
    m.findUserByEmail.mockResolvedValue(user())
    const limiter = new MemoryRateLimiter()
    for (let i = 0; i < LIMITS.otpRequestPerEmail.limit; i++) {
      await requestLoginCode.handler(ctx({ email: EMAIL }, { limiter, ipKey: `198.51.100.${i}` }))
    }
    expect(await errorCode(requestLoginCode.handler(ctx({ email: EMAIL }, { limiter, ipKey: '203.0.113.99' })))).toBe('rate_limited')
    expect(m.issueCode).toHaveBeenCalledTimes(LIMITS.otpRequestPerEmail.limit)
  })

  it('rejects a malformed email before touching storage', async () => {
    expect(await errorCode(requestLoginCode.handler(ctx({ email: 'not-an-email' })))).toBe('validation_failed')
    expect(m.findUserByEmail).not.toHaveBeenCalled()
  })
})

describe('POST otp/verify', () => {
  it('declares the per-IP code-verify limit', () => {
    expect(verifyLoginCode.ipLimits).toEqual([LIMITS.codeVerifyPerIp])
  })

  it('starts a session for a verified account, lifts the lock and clears the challenge cookie', async () => {
    m.consumeCode.mockResolvedValue({ uid: 'u1' })
    m.getUser.mockResolvedValue(user())
    const res = await verifyLoginCode.handler(ctx({ email: EMAIL, code: CODE }))
    expect(m.consumeCode).toHaveBeenCalledWith('login', emailKey(EMAIL), CODE, undefined, { challenge: sha256Hex(CHALLENGE) })
    const cookies = setCookieOf(res)
    expect(cookies).toContain(SESSION_COOKIE)
    expect(cookies.some((c) => /^__Host-otp=;.*Max-Age=0/.test(c))).toBe(true)
    expect(res.body).toEqual({ user: { uid: 'u1', email: EMAIL, emailVerified: true } })
    expect(m.recordLogin).toHaveBeenCalledWith('u1')
    expect(m.liftLock).toHaveBeenCalledWith(emailKey(EMAIL))
    expect(m.claimUnverifiedAccount).not.toHaveBeenCalled()
    expect(m.revokeAllSessions).not.toHaveBeenCalled()
  })

  it.each([
    ['no cookie', null],
    ['malformed cookie', 'short'],
  ])('%s → invalid_code without consuming an attempt', async (_label, otp) => {
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: CODE }, { otp })))).toBe('invalid_code')
    expect(m.consumeCode).not.toHaveBeenCalled()
    expect(m.createSession).not.toHaveBeenCalled()
  })

  it('marks an unverified account verified and ends its older sessions before the new one', async () => {
    m.consumeCode.mockResolvedValue({ uid: 'u1' })
    m.getUser.mockResolvedValueOnce(user({ emailVerified: false })).mockResolvedValue(user())
    const res = await verifyLoginCode.handler(ctx({ email: EMAIL, code: CODE }))
    expect(m.claimUnverifiedAccount).toHaveBeenCalledWith('u1')
    expect(m.revokeAllSessions).toHaveBeenCalledWith('u1')
    const revokeOrder = m.revokeAllSessions.mock.invocationCallOrder[0] ?? Infinity
    const createOrder = m.createSession.mock.invocationCallOrder[0] ?? -Infinity
    expect(revokeOrder).toBeLessThan(createOrder)
    expect((res.body as { user: AuthUser }).user.emailVerified).toBe(true)
  })

  it('passes through invalid_code from a wrong, expired or used code', async () => {
    m.consumeCode.mockRejectedValue(new AppError('invalid_code', 'Invalid or expired code'))
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: '00000000' })))).toBe('invalid_code')
    expect(m.createSession).not.toHaveBeenCalled()
    expect(m.liftLock).not.toHaveBeenCalled()
  })

  it('answers invalid_code when the account vanished', async () => {
    m.consumeCode.mockResolvedValue({ uid: 'u1' })
    m.getUser.mockResolvedValue(null)
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: CODE })))).toBe('invalid_code')
    expect(m.createSession).not.toHaveBeenCalled()
  })

  it('answers invalid_code when the account address no longer matches', async () => {
    m.consumeCode.mockResolvedValue({ uid: 'u1' })
    m.getUser.mockResolvedValue(user({ email: 'other@mail.com' }))
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: CODE })))).toBe('invalid_code')
    expect(m.createSession).not.toHaveBeenCalled()
    expect(m.claimUnverifiedAccount).not.toHaveBeenCalled()
  })

  it('answers invalid_code for a disabled account', async () => {
    m.consumeCode.mockResolvedValue({ uid: 'u1' })
    m.getUser.mockResolvedValue(user({ status: 'disabled' }))
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: CODE })))).toBe('invalid_code')
    expect(m.createSession).not.toHaveBeenCalled()
  })

  it('verify limit is per address+challenge: 10 checks, then rate_limited; another challenge is unaffected', async () => {
    m.consumeCode.mockRejectedValue(new AppError('invalid_code', 'Invalid or expired code'))
    const limiter = new MemoryRateLimiter()
    for (let i = 0; i < LIMITS.codeVerifyPerEmail.limit; i++) {
      expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: CODE }, { limiter })))).toBe('invalid_code')
    }
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: CODE }, { limiter })))).toBe('rate_limited')
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: CODE }, { limiter, otp: 'B'.repeat(43) })))).toBe('invalid_code')
  })

  it.each(['123456', '1234567', '123456789', 'abcdefgh', ''])('rejects malformed code %j without consuming', async (bad) => {
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: bad })))).toBe('validation_failed')
    expect(m.consumeCode).not.toHaveBeenCalled()
  })
})
