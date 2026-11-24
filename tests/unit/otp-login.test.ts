// Unit tests for the code-login routes (stage 4). Storage, sessions and mail are mocked; the real
// zod schemas, email normalisation and rate limiter run. End-to-end checks live in tests/emulator.
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
  markEmailVerified: vi.fn(),
  recordLogin: vi.fn(),
  createSession: vi.fn(),
  revokeAllSessions: vi.fn(),
  send: vi.fn(),
}))

vi.mock('../../server/auth/otp.js', () => ({ issueCode: m.issueCode, consumeCode: m.consumeCode }))
vi.mock('../../server/auth/sessions.js', () => ({
  createSession: m.createSession,
  revokeAllSessions: m.revokeAllSessions,
  deleteSessionByToken: vi.fn(async () => null),
  requireSession: vi.fn(),
  revokeFirebaseTokens: vi.fn(),
}))
vi.mock('../../server/auth/mailer.js', () => ({ mailer: () => ({ send: m.send }) }))
vi.mock('../../server/auth/users.js', () => ({
  findUserByEmail: m.findUserByEmail,
  getUser: m.getUser,
  markEmailVerified: m.markEmailVerified,
  recordLogin: m.recordLogin,
  createVerifiedUser: vi.fn(),
  isAddressTaken: vi.fn(),
  publicUser: (u: AuthUser) => ({ uid: u.uid, email: u.email, emailVerified: u.emailVerified }),
}))

const { requestLoginCode, verifyLoginCode, CODE_SENT } = await import('../../server/routes/otpLogin.js')
const { emailKey } = await import('../../server/auth/email.js')

const EMAIL = 'ann@mail.com'
const COOKIE = '__Host-session=abc; HttpOnly; Secure; SameSite=Lax; Path=/'

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

function ctx(body: unknown, limiter = new MemoryRateLimiter()): RequestContext {
  const req = { method: 'POST', url: '/', headers: { 'content-type': 'application/json' }, body } as unknown as ApiRequest
  return { req, env: {} as RequestContext['env'], ipKey: '198.51.100.10', ipPrefix: '198.51.100.0/24', limiter, requestId: 'r1', params: {} }
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

beforeEach(() => {
  vi.clearAllMocks()
  m.issueCode.mockResolvedValue('123456')
  m.createSession.mockResolvedValue(COOKIE)
})

describe('POST otp/request', () => {
  it('declares the per-IP code-request limit', () => {
    expect(requestLoginCode.ipLimits).toEqual([LIMITS.codeRequestPerIp])
  })

  it('issues a login code for the normalised address and mails it', async () => {
    m.findUserByEmail.mockResolvedValue(user())
    const res = await requestLoginCode.handler(ctx({ email: '  Ann@Mail.COM ' }))
    expect(res).toEqual(CODE_SENT)
    expect(m.findUserByEmail).toHaveBeenCalledWith(EMAIL)
    expect(m.issueCode).toHaveBeenCalledWith('login', emailKey(EMAIL), { uid: 'u1' })
    expect(m.send).toHaveBeenCalledWith({ kind: 'verify-code', to: EMAIL, code: '123456' })
  })

  it('answers identically and sends nothing when no account exists', async () => {
    m.findUserByEmail.mockResolvedValue(null)
    const res = await requestLoginCode.handler(ctx({ email: EMAIL }))
    expect(res).toEqual(CODE_SENT)
    expect(m.issueCode).not.toHaveBeenCalled()
    expect(m.send).not.toHaveBeenCalled()
  })

  it('rate-limits per email after the configured number of requests', async () => {
    m.findUserByEmail.mockResolvedValue(user())
    const limiter = new MemoryRateLimiter()
    for (let i = 0; i < LIMITS.codeRequestPerEmail.limit; i++) await requestLoginCode.handler(ctx({ email: EMAIL }, limiter))
    expect(await errorCode(requestLoginCode.handler(ctx({ email: EMAIL }, limiter)))).toBe('rate_limited')
    expect(m.issueCode).toHaveBeenCalledTimes(LIMITS.codeRequestPerEmail.limit)
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

  it('starts a session for a verified account', async () => {
    m.consumeCode.mockResolvedValue({ uid: 'u1' })
    m.getUser.mockResolvedValue(user())
    const res = await verifyLoginCode.handler(ctx({ email: EMAIL, code: '123456' }))
    expect(m.consumeCode).toHaveBeenCalledWith('login', emailKey(EMAIL), '123456')
    expect(res.headers).toEqual({ 'Set-Cookie': COOKIE })
    expect(res.body).toEqual({ user: { uid: 'u1', email: EMAIL, emailVerified: true } })
    expect(m.recordLogin).toHaveBeenCalledWith('u1')
    expect(m.markEmailVerified).not.toHaveBeenCalled()
    expect(m.revokeAllSessions).not.toHaveBeenCalled()
  })

  it('marks an unverified account verified and ends its older sessions first', async () => {
    m.consumeCode.mockResolvedValue({ uid: 'u1' })
    m.getUser.mockResolvedValueOnce(user({ emailVerified: false })).mockResolvedValue(user())
    const res = await verifyLoginCode.handler(ctx({ email: EMAIL, code: '123456' }))
    expect(m.markEmailVerified).toHaveBeenCalledWith('u1')
    expect(m.revokeAllSessions).toHaveBeenCalledWith('u1')
    const revokeOrder = m.revokeAllSessions.mock.invocationCallOrder[0] ?? Infinity
    const createOrder = m.createSession.mock.invocationCallOrder[0] ?? -Infinity
    expect(revokeOrder).toBeLessThan(createOrder)
    expect((res.body as { user: AuthUser }).user.emailVerified).toBe(true)
  })

  it('passes through invalid_code from a wrong, expired or used code', async () => {
    m.consumeCode.mockRejectedValue(new AppError('invalid_code', 'Invalid or expired code'))
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: '000000' })))).toBe('invalid_code')
    expect(m.createSession).not.toHaveBeenCalled()
  })

  it('answers invalid_code when the account vanished', async () => {
    m.consumeCode.mockResolvedValue({ uid: 'u1' })
    m.getUser.mockResolvedValue(null)
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: '123456' })))).toBe('invalid_code')
    expect(m.createSession).not.toHaveBeenCalled()
  })

  it('answers invalid_code when the account address no longer matches', async () => {
    m.consumeCode.mockResolvedValue({ uid: 'u1' })
    m.getUser.mockResolvedValue(user({ email: 'other@mail.com' }))
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: '123456' })))).toBe('invalid_code')
    expect(m.createSession).not.toHaveBeenCalled()
    expect(m.markEmailVerified).not.toHaveBeenCalled()
  })

  it.each(['12345', '1234567', 'abcdef', ''])('rejects malformed code %j without consuming', async (bad) => {
    expect(await errorCode(verifyLoginCode.handler(ctx({ email: EMAIL, code: bad })))).toBe('validation_failed')
    expect(m.consumeCode).not.toHaveBeenCalled()
  })
})
