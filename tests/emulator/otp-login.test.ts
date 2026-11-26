// Stage 4 — sign in with a one-time email code (otp/request + otp/verify), driven through the real
// router against the Firestore + Auth emulators (project "demo-bullbir" only).
// A code is bound to the browser that asked for it (HttpOnly `__Host-otp` challenge cookie), so the
// tests drive "browsers": a cookie jar + a fixed IP + a user agent.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp as deleteAdminApp, getApps as getAdminApps } from 'firebase-admin/app'
import { resetEnvForTests } from '../../server/env.js'
import { adminDb } from '../../server/firebaseAdmin.js'
import type { ApiRequest, ApiResponse } from '../../server/http.js'
import { captureLogs } from '../../server/log.js'
import { MemoryRateLimiter } from '../../server/rateLimit.js'
import { createHandler } from '../../server/router.js'
import { routes } from '../../server/routes/index.js'
import { randomToken, sha256Hex } from '../../server/auth/crypto.js'
import { emailKey, normalizeEmail } from '../../server/auth/email.js'
import { setMailerForTests, type AuthMail } from '../../server/auth/mailer.js'
import { setMinResponseMsForTests } from '../../server/auth/pacing.js'
import { hashPassword, setBreachCheckerForTests } from '../../server/auth/password.js'
import { setClockForTests } from '../../server/auth/time.js'
import {
  EMULATORS_RUNNING,
  errorCode,
  jwtPayload,
  MailBox,
  nextIp,
  ORIGIN,
  resetEmulators,
  stableBody,
  TEST_ENV,
  UA_CHROME_WIN,
  UA_FIREFOX_LINUX,
  type FakeResponse,
} from './helpers/authHarness.js'

const MINUTE = 60_000
const COOLDOWN = 61_000 // otp/request: 1 per address+IP per 60 s
const PASSWORD = 'correct horse battery staple'
const WRONG_PASSWORD = 'definitely not the password'
const CODE_SENT = { status: 'code_sent' }
const OTP_COOKIE = /^__Host-otp=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=600$/
/** Padding floors (pacing.ts default 1000 ms; otp/verify 300 ms); small tolerance for timers. */
const REQUEST_FLOOR_MS = 1000 - 15
const VERIFY_FLOOR_MS = 300 - 15

type Res = FakeResponse & { cookies: string[] }

/** A browser: own cookie jar (session + otp challenge), own IP and user agent. */
class Browser {
  session: string | undefined
  otp: string | undefined
  constructor(readonly ip: string = nextIp(), readonly userAgent: string = UA_CHROME_WIN) {}

  cookieHeader(): string | undefined {
    const parts = [
      this.session ? `__Host-session=${this.session}` : '',
      this.otp ? `__Host-otp=${this.otp}` : '',
    ].filter(Boolean)
    return parts.length ? parts.join('; ') : undefined
  }

  /** Applies Set-Cookie like a browser would (Max-Age=0 deletes). */
  absorb(cookies: string[]): void {
    for (const c of cookies) {
      const m = /^(__Host-session|__Host-otp)=([^;]*)/.exec(c)
      if (!m) continue
      const value = /Max-Age=0\b/.test(c) || m[2] === '' ? undefined : m[2]
      if (m[1] === '__Host-session') this.session = value
      else this.otp = value
    }
  }
}

async function send(handler: (req: ApiRequest, res: ApiResponse) => Promise<void>, b: Browser, method: string, path: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = {
    'x-vercel-forwarded-for': b.ip,
    'user-agent': b.userAgent,
    origin: ORIGIN,
  }
  const cookie = b.cookieHeader()
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const req = { method, url: `/api/auth/${path}`, headers, body, socket: { remoteAddress: '127.0.0.1' } } as unknown as ApiRequest
  const state = { status: 0, headers: {} as Record<string, string | string[]>, body: '' }
  const res = {
    headersSent: false,
    writableEnded: false,
    get statusCode() { return state.status },
    set statusCode(v: number) { state.status = v },
    setHeader(name: string, value: string | string[]) { state.headers[name.toLowerCase()] = value },
    end(chunk?: string) { state.body = chunk ?? ''; res.writableEnded = true },
    destroy() { res.writableEnded = true },
  }
  await handler(req, res as unknown as ApiResponse)
  const raw = state.headers['set-cookie']
  const cookies = raw === undefined ? [] : [raw].flat()
  b.absorb(cookies)
  const sessionCookie = cookies.find((c) => c.startsWith('__Host-session='))
  const m = sessionCookie ? /^__Host-session=([^;]*)/.exec(sessionCookie) : null
  return {
    status: state.status,
    headers: state.headers,
    text: state.body,
    json: state.body ? (JSON.parse(state.body) as Record<string, unknown>) : {},
    setCookie: sessionCookie,
    sessionToken: m ? m[1] : undefined,
    cookies,
  }
}

const suite = EMULATORS_RUNNING ? describe : describe.skip

suite('sign in with an email code (emulator)', () => {
  let savedEnv: Record<string, string | undefined>
  let handler: ReturnType<typeof createHandler>
  let mail: MailBox
  let clockMs: number
  let seq = 0
  let restoreQuietLogs: () => void = () => undefined

  const freshEmail = (): string => `otp${Date.now()}x${++seq}@example.test`
  const freshUid = (): string => `Otp${Date.now()}${++seq}`.padEnd(28, 'x').slice(0, 28)
  const advance = (ms: number): void => { clockMs += ms }
  const userDoc = async (uid: string) => (await adminDb().collection('users_auth').doc(uid).get()).data() ?? {}

  const call = (b: Browser, method: string, path: string, body?: unknown): Promise<Res> => send(handler, b, method, path, body)
  const requestCode = (b: Browser, email: string): Promise<Res> => call(b, 'POST', 'otp/request', { email })
  const verifyCode = (b: Browser, email: string, code: string): Promise<Res> => call(b, 'POST', 'otp/verify', { email, code })
  const login = (email: string, password: string): Promise<Res> => call(new Browser(), 'POST', 'login', { email, password })
  const me = (session: string | undefined): Promise<Res> => {
    const b = new Browser()
    b.session = session
    return call(b, 'GET', 'me')
  }

  function loginMails(email: string): Extract<AuthMail, { kind: 'login-code' }>[] {
    return mail.sent.flatMap((m) => (m.kind === 'login-code' && m.to === email ? [m] : []))
  }
  function lastLoginCode(email: string): string {
    const mails = loginMails(email)
    const last = mails[mails.length - 1]
    if (!last) throw new Error(`no login code mailed to ${email}`)
    return last.code
  }
  /** A different valid 8-digit code. */
  function otherCode8(code: string): string {
    return String((Number(code) + 1) % 100_000_000).padStart(8, '0')
  }

  type Seeded = { uid: string; email: string }

  /** Writes users_auth + auth_emails directly. */
  async function seedUser(opts: {
    emailVerified?: boolean; status?: string; legacy?: boolean; providers?: string[]
  } = {}): Promise<Seeded> {
    const uid = freshUid()
    const email = normalizeEmail(freshEmail())
    const ts = new Date()
    const db = adminDb()
    await db.collection('auth_emails').doc(emailKey(email)).create({ uid, createdAt: ts })
    await db.collection('users_auth').doc(uid).create({
      email,
      emailVerified: opts.emailVerified ?? true,
      passwordHash: await hashPassword(PASSWORD),
      legacyPassword: opts.legacy ? { hash: 'bGVnYWN5LWhhc2g=', salt: 'bGVnYWN5LXNhbHQ=' } : null,
      displayName: 'Seeded User',
      providers: opts.providers ?? ['password'],
      status: opts.status ?? 'active',
      createdAt: ts,
      updatedAt: ts,
      lastLoginAt: null,
      passwordChangedAt: null,
    })
    return { uid, email }
  }

  async function plantSession(uid: string): Promise<string> {
    const token = randomToken()
    const t = Date.now()
    await adminDb().collection('sessions').doc(sha256Hex(token)).create({
      uid,
      publicId: 'planted-session',
      createdAt: new Date(t - MINUTE),
      lastSeenAt: new Date(t - MINUTE),
      idleExpiresAt: new Date(t + 7 * 1440 * MINUTE),
      absoluteExpiresAt: new Date(t + 30 * 1440 * MINUTE),
      expiresAt: new Date(t + 7 * 1440 * MINUTE),
      device: 'Planted device',
      ipPrefix: '10.0.0',
    })
    return token
  }

  /** request → verify with the mailed code, in one browser; returns the verify response. */
  async function codeLogin(email: string, b = new Browser()): Promise<Res> {
    const r = await requestCode(b, email)
    expect(r.status).toBe(202)
    return verifyCode(b, email, lastLoginCode(email))
  }

  async function failUntilLocked(email: string): Promise<Res> {
    for (let i = 0; i < 6; i++) {
      const r = await login(email, WRONG_PASSWORD)
      if (r.status === 429) return r
      expect(r.status, `failure #${i + 1}`).toBe(401)
    }
    throw new Error('never locked')
  }

  beforeAll(() => {
    savedEnv = Object.fromEntries([...Object.keys(TEST_ENV), 'VERCEL'].map((k) => [k, process.env[k]]))
    Object.assign(process.env, TEST_ENV)
    process.env.VERCEL = '1'
    resetEnvForTests()
  })

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    setMailerForTests(undefined)
    setBreachCheckerForTests(undefined)
    setClockForTests(undefined)
    setMinResponseMsForTests(undefined)
    await Promise.all(getAdminApps().map((a) => deleteAdminApp(a)))
    resetEnvForTests()
  })

  beforeEach(async () => {
    await resetEmulators()
    restoreQuietLogs = captureLogs(() => undefined)
    mail = new MailBox()
    setMailerForTests(mail)
    setBreachCheckerForTests(async () => false) // never the real HIBP
    setMinResponseMsForTests(0)
    clockMs = Date.now()
    setClockForTests(() => clockMs)
    const limiter = new MemoryRateLimiter(() => clockMs) // same virtual clock as the server
    handler = createHandler(routes, { limiter: () => limiter })
  })

  afterEach(() => {
    setClockForTests(undefined)
    setMinResponseMsForTests(0)
    setMailerForTests(mail)
    restoreQuietLogs()
  })

  // ------------------------------------------------------------------ 1. happy path

  it('verified account: request → 202 + challenge cookie + login-code mail; verify → session; me + bridge token', async () => {
    const u = await seedUser()
    const b = new Browser(nextIp(), UA_FIREFOX_LINUX)
    const r = await requestCode(b, u.email)
    expect(r.status).toBe(202)
    expect(r.json).toEqual(CODE_SENT)
    expect(r.cookies).toHaveLength(1)
    expect(r.cookies[0]).toMatch(OTP_COOKIE)
    expect(r.sessionToken).toBeUndefined()
    expect(mail.kindsFor(u.email)).toEqual(['login-code'])
    const sent = loginMails(u.email)[0]!
    expect(sent.code).toMatch(/^\d{8}$/)
    expect(sent.device).toBe('Firefox · Linux')
    expect(sent.at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/)
    expect(r.text).not.toContain(sent.code)

    const v = await verifyCode(b, u.email, sent.code)
    expect(v.status, v.text).toBe(200)
    expect(v.json.user).toMatchObject({ uid: u.uid, email: u.email, emailVerified: true })
    expect(v.setCookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{43};/)
    expect(v.setCookie).toContain('HttpOnly')
    expect(v.cookies.some((c) => /^__Host-otp=;.*Max-Age=0/.test(c))).toBe(true) // challenge cleared
    expect(b.otp).toBeUndefined()
    expect(v.text).not.toMatch(/hash|argon/i)

    const meRes = await me(v.sessionToken)
    expect(meRes.status).toBe(200)
    expect(meRes.json.user).toMatchObject({ uid: u.uid, email: u.email })

    const ft = await call(b, 'POST', 'firebase-token')
    expect(ft.status).toBe(200)
    const payload = jwtPayload(ft.json.token as string)
    expect(payload.uid).toBe(u.uid)
    expect((payload.claims as { bb_ev?: unknown } | undefined)?.bb_ev).toBe(true)

    // The password of a verified account is untouched by a code login.
    expect((await userDoc(u.uid)).passwordHash).toMatch(/^\$argon2id\$/)
    expect((await login(u.email, PASSWORD)).status).toBe(200)
  })

  it('address is normalized (case, spaces) on request and verify', async () => {
    const u = await seedUser()
    const b = new Browser()
    expect((await requestCode(b, `  ${u.email.toUpperCase()} `)).status).toBe(202)
    const v = await verifyCode(b, ` ${u.email.toUpperCase()}`, lastLoginCode(u.email))
    expect(v.status, v.text).toBe(200)
  })

  // ------------------------------------------------------------------ 2. no enumeration

  describe('unknown and disabled addresses', () => {
    it('same status, body and cookie shape as an existing account; no mail', async () => {
      const real = await seedUser()
      const disabled = await seedUser({ status: 'disabled' })
      const unknown = freshEmail()
      const answers = await Promise.all([real.email, unknown, disabled.email].map((e) => requestCode(new Browser(), e)))
      for (const r of answers) {
        expect(r.status).toBe(202)
        expect(r.text).toBe(answers[0]!.text)
        expect(r.cookies).toHaveLength(1)
        expect(r.cookies[0]).toMatch(OTP_COOKIE)
      }
      expect(new Set(answers.map((r) => r.cookies[0])).size).toBe(3) // a fresh challenge each time
      expect(mail.kindsFor(real.email)).toEqual(['login-code'])
      expect(mail.kindsFor(unknown)).toEqual([])
      expect(mail.kindsFor(disabled.email)).toEqual([])
      expect(mail.sent).toHaveLength(1)
      expect((await adminDb().collection('otp_codes').get()).size).toBe(1)
    })

    it('verify for unknown / disabled answers exactly like a wrong code', async () => {
      const real = await seedUser()
      const disabled = await seedUser({ status: 'disabled' })
      const a = new Browser()
      await requestCode(a, real.email)
      const wrong = await verifyCode(a, real.email, otherCode8(lastLoginCode(real.email)))
      const bu = new Browser()
      await requestCode(bu, freshEmail())
      const unknown = await verifyCode(bu, freshEmail(), '12345678')
      const bd = new Browser()
      await requestCode(bd, disabled.email)
      const dis = await verifyCode(bd, disabled.email, '12345678')
      for (const r of [wrong, unknown, dis]) {
        expect(r.status).toBe(400)
        expect(errorCode(r)).toBe('invalid_code')
        expect(r.sessionToken).toBeUndefined()
      }
      expect(stableBody(unknown)).toEqual(stableBody(wrong))
      expect(stableBody(dis)).toEqual(stableBody(wrong))
    })

    it('with padding enabled, request takes ≥ ~1 s for existing, unknown and disabled; verify ≥ ~300 ms', async () => {
      const real = await seedUser()
      const disabled = await seedUser({ status: 'disabled' })
      setMinResponseMsForTests(undefined) // production floor
      for (const email of [real.email, freshEmail(), disabled.email]) {
        const t = performance.now()
        const r = await requestCode(new Browser(), email)
        const took = performance.now() - t
        expect(r.status).toBe(202)
        expect(took, email).toBeGreaterThanOrEqual(REQUEST_FLOOR_MS)
      }
      const t = performance.now()
      const bad = await verifyCode(new Browser(), real.email, '12345678')
      expect(errorCode(bad)).toBe('invalid_code')
      expect(performance.now() - t).toBeGreaterThanOrEqual(VERIFY_FLOOR_MS)
      expect(mail.sent).toHaveLength(1)
    }, 20_000)

    it('a mail failure still answers 202 with a challenge cookie', async () => {
      const u = await seedUser()
      setMailerForTests({ send: async () => { throw new Error('smtp down') } })
      const r = await requestCode(new Browser(), u.email)
      expect(r.status).toBe(202)
      expect(r.json).toEqual(CODE_SENT)
      expect(r.cookies[0]).toMatch(OTP_COOKIE)
    })
  })

  // ------------------------------------------------------------------ 3. code security

  describe('code security', () => {
    it('wrong code → invalid_code; the right code still works afterwards', async () => {
      const u = await seedUser()
      const b = new Browser()
      await requestCode(b, u.email)
      const code = lastLoginCode(u.email)
      const bad = await verifyCode(b, u.email, otherCode8(code))
      expect(bad.status).toBe(400)
      expect(errorCode(bad)).toBe('invalid_code')
      expect(bad.cookies).toHaveLength(0) // challenge kept for a retry
      expect((await verifyCode(b, u.email, code)).status).toBe(200)
    })

    it('single use: the same code twice → second is invalid_code (even with the challenge re-presented)', async () => {
      const u = await seedUser()
      const b = new Browser()
      await requestCode(b, u.email)
      const challenge = b.otp
      const code = lastLoginCode(u.email)
      expect((await verifyCode(b, u.email, code)).status).toBe(200)
      b.otp = challenge
      const again = await verifyCode(b, u.email, code)
      expect(errorCode(again)).toBe('invalid_code')
      expect(again.sessionToken).toBeUndefined()
    })

    it('expires after 10 minutes', async () => {
      const u = await seedUser()
      const b = new Browser()
      await requestCode(b, u.email)
      advance(10 * MINUTE + 1)
      expect(errorCode(await verifyCode(b, u.email, lastLoginCode(u.email)))).toBe('invalid_code')
    })

    it('still valid just before 10 minutes', async () => {
      const u = await seedUser()
      const b = new Browser()
      await requestCode(b, u.email)
      advance(10 * MINUTE - 5_000)
      expect((await verifyCode(b, u.email, lastLoginCode(u.email))).status).toBe(200)
    })

    it('5 wrong attempts burn the code (the correct code then fails)', async () => {
      const u = await seedUser()
      const b = new Browser()
      await requestCode(b, u.email)
      const code = lastLoginCode(u.email)
      for (let i = 0; i < 5; i++) expect(errorCode(await verifyCode(b, u.email, otherCode8(code))), `attempt ${i + 1}`).toBe('invalid_code')
      const r = await verifyCode(b, u.email, code)
      expect(errorCode(r)).toBe('invalid_code')
      expect(r.sessionToken).toBeUndefined()
    })

    it('without the challenge cookie the right code fails and no attempt is consumed', async () => {
      const u = await seedUser()
      const owner = new Browser()
      await requestCode(owner, u.email)
      const code = lastLoginCode(u.email)
      const bare = new Browser()
      for (let i = 0; i < 6; i++) expect(errorCode(await verifyCode(bare, u.email, otherCode8(code)))).toBe('invalid_code')
      expect(errorCode(await verifyCode(bare, u.email, code))).toBe('invalid_code')
      const doc = (await adminDb().collection('otp_codes').get()).docs[0]!
      expect(doc.get('attempts')).toBe(0)
      expect((await verifyCode(owner, u.email, code)).status).toBe(200)
    })

    it('a code from browser A does not work from browser B (B has its own challenge)', async () => {
      const u = await seedUser()
      const a = new Browser()
      const b = new Browser()
      await requestCode(a, u.email)
      const codeA = lastLoginCode(u.email)
      await requestCode(b, u.email)
      expect(errorCode(await verifyCode(b, u.email, codeA))).toBe('invalid_code')
      expect((await verifyCode(a, u.email, codeA)).status).toBe(200)
    })

    it('B’s request does not replace or invalidate A’s code', async () => {
      const u = await seedUser()
      const a = new Browser()
      const b = new Browser()
      await requestCode(a, u.email)
      const codeA = lastLoginCode(u.email)
      await requestCode(b, u.email)
      const codeB = lastLoginCode(u.email)
      expect((await adminDb().collection('otp_codes').get()).size).toBe(2)
      expect((await verifyCode(a, u.email, codeA)).status).toBe(200)
      expect((await verifyCode(b, u.email, codeB)).status).toBe(200)
    })

    it('5 wrong guesses from an attacker’s own challenge do not burn the owner’s code', async () => {
      const u = await seedUser()
      const owner = new Browser()
      const attacker = new Browser()
      await requestCode(owner, u.email)
      const code = lastLoginCode(u.email)
      await requestCode(attacker, u.email)
      for (let i = 0; i < 5; i++) expect(errorCode(await verifyCode(attacker, u.email, otherCode8(code)))).toBe('invalid_code')
      // The attacker's own code burned; the owner's is intact.
      expect(errorCode(await verifyCode(attacker, u.email, lastLoginCode(u.email)))).toBe('invalid_code')
      expect((await verifyCode(owner, u.email, code)).status).toBe(200)
    })

    it('a new request in the same browser supersedes its old code', async () => {
      const u = await seedUser()
      const b = new Browser()
      await requestCode(b, u.email)
      const first = lastLoginCode(u.email)
      advance(COOLDOWN)
      expect((await requestCode(b, u.email)).status).toBe(202)
      const second = lastLoginCode(u.email)
      expect(loginMails(u.email)).toHaveLength(2)
      if (first !== second) expect(errorCode(await verifyCode(b, u.email, first))).toBe('invalid_code')
      expect((await verifyCode(b, u.email, second)).status).toBe(200)
    })

    it('a registration (verify) code and a login code are not interchangeable', async () => {
      // An unverified account can hold both kinds of code at once.
      const u = await seedUser({ emailVerified: false })
      const b = new Browser()
      expect((await call(b, 'POST', 'register', { email: u.email, password: PASSWORD })).status).toBe(202)
      expect((await requestCode(b, u.email)).status).toBe(202)
      expect(mail.kindsFor(u.email)).toEqual(['verify-code', 'login-code'])
      const registrationCode = mail.lastCode(u.email) // 6 digits
      const loginCode = lastLoginCode(u.email) // 8 digits

      const a = await verifyCode(b, u.email, registrationCode)
      expect(a.status).toBe(400)
      expect(a.sessionToken).toBeUndefined()
      const padded = await verifyCode(b, u.email, `${registrationCode}00`)
      expect(errorCode(padded)).toBe('invalid_code')
      const cross = await call(b, 'POST', 'verify-email', { email: u.email, code: loginCode.slice(0, 6), password: PASSWORD })
      expect(cross.status).toBe(400)
      expect(cross.sessionToken).toBeUndefined()
      expect((await userDoc(u.uid)).emailVerified).toBe(false)
      // The login code still works where it belongs.
      expect((await verifyCode(b, u.email, loginCode)).status).toBe(200)
    })

    it('a code issued for another address does not work', async () => {
      const x = await seedUser()
      const y = await seedUser()
      const b = new Browser()
      await requestCode(b, x.email)
      const codeX = lastLoginCode(x.email)
      expect(errorCode(await verifyCode(b, y.email, codeX))).toBe('invalid_code')
      const r = await verifyCode(b, x.email, codeX)
      expect(r.status).toBe(200)
      expect((r.json.user as { uid: string }).uid).toBe(x.uid)
    })

    it('the stored code is never the plain code or the plain challenge', async () => {
      const u = await seedUser()
      const b = new Browser()
      await requestCode(b, u.email)
      const docs = await adminDb().collection('otp_codes').get()
      expect(docs.size).toBe(1)
      const stored = JSON.stringify({ id: docs.docs[0]!.id, ...docs.docs[0]!.data() })
      expect(stored).not.toContain(lastLoginCode(u.email))
      expect(stored).not.toContain(b.otp as string)
    })
  })

  // ------------------------------------------------------------------ 4. limits

  describe('limits', () => {
    it('cooldown: a 2nd request from the same address+IP within 60 s → 429 with Retry-After', async () => {
      const u = await seedUser()
      const b = new Browser()
      expect((await requestCode(b, u.email)).status).toBe(202)
      const r = await requestCode(b, u.email)
      expect(r.status).toBe(429)
      expect(errorCode(r)).toBe('rate_limited')
      expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1)
      expect(loginMails(u.email)).toHaveLength(1)
    })

    it('4th request for the same address+IP within 15 min → 429; another IP (the owner) is unaffected', async () => {
      const u = await seedUser()
      const attacker = new Browser()
      for (let i = 0; i < 3; i++) {
        expect((await requestCode(attacker, u.email)).status, `request ${i + 1}`).toBe(202)
        advance(COOLDOWN)
      }
      const r = await requestCode(attacker, u.email)
      expect(r.status).toBe(429)
      expect(errorCode(r)).toBe('rate_limited')
      expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1)
      expect(loginMails(u.email)).toHaveLength(3)
      expect((await codeLogin(u.email)).status).toBe(200)
    })

    it('per address overall: the 11th request within an hour (from different IPs) → 429', async () => {
      const u = await seedUser()
      for (let i = 0; i < 10; i++) expect((await requestCode(new Browser(), u.email)).status, `request ${i + 1}`).toBe(202)
      const r = await requestCode(new Browser(), u.email)
      expect(r.status).toBe(429)
      expect(loginMails(u.email)).toHaveLength(10)
    })

    it('unknown addresses hit the same request limits', async () => {
      const email = freshEmail()
      const b = new Browser()
      expect((await requestCode(b, email)).status).toBe(202)
      expect((await requestCode(b, email)).status).toBe(429)
    })

    it('verify limit: 10 checks/hour per address+challenge, then 429; another browser is unaffected', async () => {
      const u = await seedUser()
      const attacker = new Browser()
      await requestCode(attacker, u.email)
      for (let i = 0; i < 10; i++) expect((await verifyCode(attacker, u.email, '00000000')).status, `check ${i + 1}`).toBe(400)
      const limited = await verifyCode(attacker, u.email, '00000000')
      expect(limited.status).toBe(429)
      expect(errorCode(limited)).toBe('rate_limited')
      expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1)
      expect((await codeLogin(u.email)).status).toBe(200)
    })
  })

  // ------------------------------------------------------------------ 5. lockout recovery

  it('a password lockout is lifted by a code login; the correct password works immediately; the lock level is kept', async () => {
    const u = await seedUser()
    const first = await failUntilLocked(u.email)
    expect(Number(first.headers['retry-after'])).toBeLessThanOrEqual(15 * 60)
    expect((await login(u.email, PASSWORD)).status).toBe(429) // locked even for the owner

    const v = await codeLogin(u.email)
    expect(v.status, v.text).toBe(200)
    const throttle = await adminDb().collection('auth_throttle').doc(emailKey(u.email)).get()
    expect(throttle.get('lockedUntil') ?? null).toBeNull()
    expect(throttle.get('failures') ?? 0).toBe(0)

    const after = await login(u.email, PASSWORD)
    expect(after.status, after.text).toBe(200)
    expect(after.sessionToken).toBeTruthy()

    // Password success resets everything; an attacker guessing without one keeps doubling.
    const u2 = await seedUser()
    await failUntilLocked(u2.email)
    expect((await codeLogin(u2.email)).status).toBe(200)
    const second = await failUntilLocked(u2.email)
    const retry = Number(second.headers['retry-after'])
    expect(retry).toBeGreaterThan(29 * 60)
    expect(retry).toBeLessThanOrEqual(30 * 60)
  })

  // ------------------------------------------------------------------ 6. unverified imported account

  it('unverified imported account: code login confirms it and wipes old credentials, links and sessions', async () => {
    const u = await seedUser({ emailVerified: false, legacy: true, providers: ['google.com', 'password'] })
    const db = adminDb()
    const link = db.collection('auth_accounts').doc('google.com:squatter-sub')
    await link.create({ uid: u.uid, provider: 'google.com', email: 'squatter@gmail.test', linkedAt: new Date() })
    const otherLink = db.collection('auth_accounts').doc('google.com:someone-else')
    await otherLink.create({ uid: 'SomeoneElseUid0000000000000', provider: 'google.com', email: 'x@gmail.test', linkedAt: new Date() })
    const planted = await plantSession(u.uid)
    expect((await me(planted)).status).toBe(200)
    // The creator's password is valid before the claim (it asks for email confirmation).
    expect(errorCode(await login(u.email, PASSWORD))).toBe('email_unverified')

    const b = new Browser()
    const v = await codeLogin(u.email, b)
    expect(v.status, v.text).toBe(200)
    expect(v.json.user).toMatchObject({ uid: u.uid, email: u.email, emailVerified: true, providers: [] })

    const doc = await userDoc(u.uid)
    expect(doc.emailVerified).toBe(true)
    expect(doc.passwordHash).toBeNull()
    expect(doc.legacyPassword).toBeNull()
    expect(doc.providers).toEqual([])
    expect(doc.passwordChangedAt).toBeTruthy()
    expect((await link.get()).exists).toBe(false)
    expect((await db.collection('auth_accounts').where('uid', '==', u.uid).get()).size).toBe(0)
    expect((await otherLink.get()).exists).toBe(true)
    expect((await db.collection('users_auth').get()).size).toBe(1)

    expect((await db.collection('sessions').doc(sha256Hex(planted)).get()).exists).toBe(false)
    expect((await me(planted)).status).toBe(401)
    const squatter = new Browser()
    squatter.session = planted
    expect((await call(squatter, 'POST', 'firebase-token')).status).toBe(401)

    expect((await me(v.sessionToken)).status).toBe(200)
    const ft = await call(b, 'POST', 'firebase-token')
    expect(ft.status).toBe(200)
    expect((jwtPayload(ft.json.token as string).claims as { bb_ev?: unknown }).bb_ev).toBe(true)

    const old = await login(u.email, PASSWORD)
    expect(old.status).toBe(401)
    expect(errorCode(old)).toBe('invalid_credentials')
  })

  // ------------------------------------------------------------------ 7. changes between request and verify

  describe('account changed between request and verify', () => {
    it('address changed → invalid_code', async () => {
      const u = await seedUser()
      const b = new Browser()
      await requestCode(b, u.email)
      const code = lastLoginCode(u.email)
      const newEmail = normalizeEmail(freshEmail())
      const db = adminDb()
      await db.collection('auth_emails').doc(emailKey(u.email)).delete()
      await db.collection('auth_emails').doc(emailKey(newEmail)).create({ uid: u.uid, createdAt: new Date() })
      await db.collection('users_auth').doc(u.uid).update({ email: newEmail })
      const r = await verifyCode(b, u.email, code)
      expect(r.status).toBe(400)
      expect(errorCode(r)).toBe('invalid_code')
      expect(r.sessionToken).toBeUndefined()
      expect((await db.collection('sessions').where('uid', '==', u.uid).get()).size).toBe(0)
    })

    it('account deleted → invalid_code', async () => {
      const u = await seedUser()
      const b = new Browser()
      await requestCode(b, u.email)
      const code = lastLoginCode(u.email)
      const db = adminDb()
      await db.collection('users_auth').doc(u.uid).delete()
      await db.collection('auth_emails').doc(emailKey(u.email)).delete()
      const r = await verifyCode(b, u.email, code)
      expect(r.status).toBe(400)
      expect(errorCode(r)).toBe('invalid_code')
      expect(r.sessionToken).toBeUndefined()
      expect((await db.collection('sessions').get()).size).toBe(0)
    })

    it('account disabled → invalid_code', async () => {
      const u = await seedUser()
      const b = new Browser()
      await requestCode(b, u.email)
      const code = lastLoginCode(u.email)
      await adminDb().collection('users_auth').doc(u.uid).update({ status: 'disabled' })
      const r = await verifyCode(b, u.email, code)
      expect(errorCode(r)).toBe('invalid_code')
      expect(r.sessionToken).toBeUndefined()
    })
  })

  // ------------------------------------------------------------------ 8. logs

  it('no secrets in logs during a code-login flow (code, challenge, session token, custom token)', async () => {
    const lines: string[] = []
    const restore = captureLogs((l) => lines.push(l))
    const secrets: string[] = []
    let custom = ''
    try {
      const u = await seedUser({ emailVerified: false })
      const b = new Browser()
      await requestCode(b, u.email)
      secrets.push(b.otp as string)
      const code = lastLoginCode(u.email)
      secrets.push(code)
      await verifyCode(b, u.email, otherCode8(code))
      const v = await verifyCode(b, u.email, code)
      expect(v.status).toBe(200)
      secrets.push(v.sessionToken as string)
      const ft = await call(b, 'POST', 'firebase-token')
      custom = ft.json.token as string
      secrets.push(custom)
      setMailerForTests({ send: async () => { throw new Error('smtp down') } })
      const other = await seedUser()
      await requestCode(new Browser(), other.email)
      await requestCode(new Browser(), freshEmail())
      await call(b, 'POST', 'logout')
    } finally {
      restore()
    }
    expect(lines.length).toBeGreaterThan(3)
    const all = lines.join('\n')
    for (const s of secrets) {
      expect(s.length).toBeGreaterThan(5)
      expect(all).not.toContain(s)
    }
    for (const part of custom.split('.').filter((p) => p.length > 20)) expect(all).not.toContain(part)
  })
})
