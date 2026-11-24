// End-to-end auth flows against the Firestore + Auth emulators, driven through the real router.
// Covers the threat matrix in docs/auth-migration-plan.md. Project "demo-bullbir" only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, inMemoryPersistence, initializeAuth, signInWithCustomToken, signOut, type Auth } from 'firebase/auth'
import { deleteApp as deleteAdminApp, getApps as getAdminApps } from 'firebase-admin/app'
import { resetEnvForTests } from '../../server/env.js'
import { adminAuth, adminDb } from '../../server/firebaseAdmin.js'
import { captureLogs } from '../../server/log.js'
import { MemoryRateLimiter } from '../../server/rateLimit.js'
import { createHandler } from '../../server/router.js'
import { routes } from '../../server/routes/index.js'
import { emailKey } from '../../server/auth/email.js'
import { setMailerForTests } from '../../server/auth/mailer.js'
import { setMinResponseMsForTests } from '../../server/auth/pacing.js'
import { setBreachCheckerForTests } from '../../server/auth/password.js'
import { setClockForTests } from '../../server/auth/time.js'
import {
  AUTH_HOST,
  call as rawCall,
  EMULATORS_RUNNING,
  errorCode,
  jwtPayload,
  MailBox,
  median,
  otherCode,
  PROJECT_ID,
  resetEmulators,
  stableBody,
  TEST_ENV,
  UA_FIREFOX_LINUX,
  type CallOptions,
  type FakeResponse,
} from './helpers/authHarness.js'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const BREACHED = 'password123456'
const PASSWORD = 'correct horse battery staple'
const PASSWORD_2 = 'another long passphrase 42'

const suite = EMULATORS_RUNNING ? describe : describe.skip

suite('auth flows (emulator)', () => {
  let savedEnv: Record<string, string | undefined>
  let handler: ReturnType<typeof createHandler>
  let mail: MailBox
  let clockMs: number
  let seq = 0
  let restoreQuietLogs: () => void = () => undefined

  const call = (method: string, path: string, opts?: CallOptions): Promise<FakeResponse> => rawCall(handler, method, path, opts)
  const freshEmail = (): string => `user${Date.now()}x${++seq}@example.test`
  const advance = (ms: number): void => { clockMs += ms }

  async function register(email: string, password = PASSWORD, extra: CallOptions = {}): Promise<FakeResponse> {
    return call('POST', 'register', { ...extra, body: { email, password } })
  }

  async function verify(email: string, code: string, password = PASSWORD, extra: CallOptions = {}): Promise<FakeResponse> {
    return call('POST', 'verify-email', { ...extra, body: { email, code, password } })
  }

  async function resend(email: string, password = PASSWORD): Promise<FakeResponse> {
    return call('POST', 'verify-email/resend', { body: { email, password } })
  }

  async function login(email: string, password = PASSWORD, extra: CallOptions = {}): Promise<FakeResponse> {
    return call('POST', 'login', { ...extra, body: { email, password } })
  }

  /** Registers + verifies; returns the session token and uid. */
  async function signUp(email = freshEmail(), password = PASSWORD): Promise<{ email: string; token: string; uid: string }> {
    expect((await register(email, password)).status).toBe(202)
    const r = await verify(email, mail.lastCode(email), password)
    expect(r.status).toBe(200)
    expect(r.sessionToken).toBeTruthy()
    return { email, token: r.sessionToken as string, uid: (r.json.user as { uid: string }).uid }
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
    restoreQuietLogs = captureLogs(() => undefined) // keep request logs out of the test output
    mail = new MailBox()
    setMailerForTests(mail)
    setBreachCheckerForTests(async (p) => p === BREACHED) // never the real HIBP
    setMinResponseMsForTests(0)
    clockMs = Date.now()
    setClockForTests(() => clockMs)
    const limiter = new MemoryRateLimiter()
    handler = createHandler(routes, { limiter: () => limiter })
  })

  afterEach(() => {
    setClockForTests(undefined)
    restoreQuietLogs()
  })

  // ------------------------------------------------------------------ registration & bridge

  describe('register → verify → session → bridge', () => {
    let clientApp: FirebaseApp | undefined
    let clientAuth: Auth | undefined

    afterEach(async () => {
      if (clientAuth) await signOut(clientAuth).catch(() => undefined)
      if (clientApp) await deleteApp(clientApp)
      clientApp = undefined
      clientAuth = undefined
    })

    it('full happy path, ending in a Firebase session with the same uid and bb_ev=true', async () => {
      const email = freshEmail()
      const reg = await register(email)
      expect(reg.status).toBe(202)
      expect(reg.json).toEqual({ status: 'verification_sent' })
      expect(reg.setCookie).toBeUndefined()
      expect(mail.kindsFor(email)).toEqual(['verify-code'])
      // Nothing usable exists before verification.
      expect(errorCode(await login(email))).toBe('invalid_credentials')

      const v = await verify(email, mail.lastCode(email))
      expect(v.status).toBe(200)
      const user = v.json.user as Record<string, unknown>
      expect(user).toMatchObject({ email, emailVerified: true, providers: ['password'] })
      expect(Object.keys(user).sort()).toEqual(['createdAt', 'displayName', 'email', 'emailVerified', 'lastLoginAt', 'providers', 'uid'])
      expect(v.setCookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{43};/)
      expect(v.setCookie).toContain('HttpOnly')
      expect(v.setCookie).toContain('Secure')
      expect(v.setCookie).toContain('SameSite=Lax')
      expect(v.setCookie).toContain('Path=/')
      expect(v.setCookie).not.toMatch(/domain=/i)
      const token = v.sessionToken as string

      const me = await call('GET', 'me', { cookie: token })
      expect(me.status).toBe(200)
      expect(me.json.user).toMatchObject({ uid: user.uid, email, emailVerified: true })
      expect(me.text).not.toMatch(/hash|argon/i)

      const ft = await call('POST', 'firebase-token', { cookie: token })
      expect(ft.status).toBe(200)
      const custom = ft.json.token as string
      expect(typeof custom).toBe('string')

      clientApp = initializeApp({ projectId: PROJECT_ID, apiKey: 'fake-api-key' }, `auth-flow-${Date.now()}`)
      clientAuth = initializeAuth(clientApp, { persistence: inMemoryPersistence })
      connectAuthEmulator(clientAuth, `http://${AUTH_HOST}`, { disableWarnings: true })
      const cred = await signInWithCustomToken(clientAuth, custom)
      expect(cred.user.uid).toBe(user.uid)
      const idToken = await cred.user.getIdTokenResult()
      expect(idToken.claims.bb_ev).toBe(true)
    })

    it('firebase-token and me without a session → 401', async () => {
      expect((await call('POST', 'firebase-token')).status).toBe(401)
      const me = await call('GET', 'me')
      expect(me.status).toBe(401)
      expect(errorCode(me)).toBe('unauthorized')
    })
  })

  describe('registration does not reveal or take over existing accounts', () => {
    it('already VERIFIED email: same answer, no cookie, "already-registered" mail, password unchanged', async () => {
      const { email } = await signUp()
      const fresh = await register(freshEmail(), PASSWORD_2)
      const again = await register(email, PASSWORD_2)
      expect(again.status).toBe(fresh.status)
      expect(again.json).toEqual(fresh.json)
      expect(again.setCookie).toBeUndefined()
      expect(mail.kindsFor(email)).toEqual(['verify-code', 'already-registered'])
      expect(mail.codesFor(email)).toHaveLength(1)

      expect((await login(email, PASSWORD)).status).toBe(200)
      expect(errorCode(await login(email, PASSWORD_2))).toBe('invalid_credentials')
    })

    it('an email that exists only in Firebase Auth counts as taken', async () => {
      const email = freshEmail()
      await adminAuth().createUser({ email, password: 'legacy-password-1' })
      const r = await register(email)
      expect(r.status).toBe(202)
      expect(r.json).toEqual({ status: 'verification_sent' })
      expect(mail.kindsFor(email)).toEqual(['already-registered'])
      expect(errorCode(await login(email))).toBe('invalid_credentials')
    })

    it('attacker pre-registers the victim address: the victim\'s code only works with the latest registrant\'s password', async () => {
      const email = freshEmail()
      // Attacker registers first (password A) — code goes to the victim's mailbox.
      await register(email, PASSWORD_2)
      // Victim registers too (password V) — replaces the pending registration.
      await register(email, PASSWORD)
      const victimCode = mail.lastCode(email)
      // Attacker cannot log in with A: there is no account yet.
      expect(errorCode(await login(email, PASSWORD_2))).toBe('invalid_credentials')
      // Victim uses the newest code with V → account with V.
      const ok = await verify(email, victimCode, PASSWORD)
      expect(ok.status).toBe(200)
      expect(errorCode(await login(email, PASSWORD_2))).toBe('invalid_credentials')
      expect((await login(email, PASSWORD)).status).toBe(200)
    })

    it('code from the attacker\'s registration + the victim\'s password fails; the matching password works', async () => {
      const email = freshEmail()
      await register(email, PASSWORD_2) // attacker, password A
      const code = mail.lastCode(email)
      const wrong = await verify(email, code, PASSWORD) // victim's V does not match the pending A
      expect(wrong.status).toBe(400)
      expect(errorCode(wrong)).toBe('invalid_code')
      expect(wrong.setCookie).toBeUndefined()
      const right = await verify(email, code, PASSWORD_2)
      expect(right.status).toBe(200)
      expect(right.sessionToken).toBeTruthy()
    })
  })

  // ------------------------------------------------------------------ codes

  describe('verification codes', () => {
    it('wrong code → invalid_code; right code then works', async () => {
      const email = freshEmail()
      await register(email)
      const code = mail.lastCode(email)
      const bad = await verify(email, otherCode(code))
      expect(bad.status).toBe(400)
      expect(errorCode(bad)).toBe('invalid_code')
      expect((await verify(email, code)).status).toBe(200)
    })

    it('single use: the same code twice → second is invalid_code', async () => {
      const email = freshEmail()
      await register(email)
      const code = mail.lastCode(email)
      expect((await verify(email, code)).status).toBe(200)
      const second = await verify(email, code)
      expect(errorCode(second)).toBe('invalid_code')
      expect(second.setCookie).toBeUndefined()
    })

    it('expires after 10 minutes', async () => {
      const email = freshEmail()
      await register(email)
      const code = mail.lastCode(email)
      advance(10 * MINUTE + 1)
      expect(errorCode(await verify(email, code))).toBe('invalid_code')
    })

    it('still valid just before 10 minutes', async () => {
      const email = freshEmail()
      await register(email)
      const code = mail.lastCode(email)
      advance(10 * MINUTE - 5_000)
      expect((await verify(email, code)).status).toBe(200)
    })

    it('5 wrong attempts burn the code (the correct code then fails)', async () => {
      const email = freshEmail()
      await register(email)
      const code = mail.lastCode(email)
      for (let i = 0; i < 5; i++) expect(errorCode(await verify(email, otherCode(code)))).toBe('invalid_code')
      expect(errorCode(await verify(email, code))).toBe('invalid_code')
    })

    it('a wrong password counts as a failed attempt', async () => {
      const email = freshEmail()
      await register(email)
      const code = mail.lastCode(email)
      for (let i = 0; i < 5; i++) expect(errorCode(await verify(email, code, PASSWORD_2))).toBe('invalid_code')
      expect(errorCode(await verify(email, code, PASSWORD))).toBe('invalid_code')
    })

    it('a code issued for another address does not work', async () => {
      const a = freshEmail()
      const b = freshEmail()
      await register(a)
      await register(b)
      expect(errorCode(await verify(b, mail.lastCode(a)))).toBe('invalid_code')
      expect(errorCode(await verify(a, mail.lastCode(b)))).toBe('invalid_code')
    })

    it('resend replaces the code (the old one stops working)', async () => {
      const email = freshEmail()
      await register(email)
      const first = mail.lastCode(email)
      const r = await resend(email)
      expect(r.status).toBe(202)
      const second = mail.lastCode(email)
      if (second !== first) expect(errorCode(await verify(email, first))).toBe('invalid_code')
      expect((await verify(email, second)).status).toBe(200)
    })

    it('resend answers identically for unknown, pending and verified addresses', async () => {
      const { email: verified } = await signUp()
      const pending = freshEmail()
      await register(pending)
      const unknown = freshEmail()
      const answers = await Promise.all([unknown, pending, verified].map((email) => resend(email)))
      for (const a of answers) {
        expect(a.status).toBe(202)
        expect(a.json).toEqual({ status: 'verification_sent' })
        expect(a.setCookie).toBeUndefined()
      }
      // A verified address only ever gets a notice, never a code.
      expect(mail.kindsFor(verified)).toEqual(['verify-code', 'already-registered'])
      expect(mail.kindsFor(pending)).toEqual(['verify-code', 'verify-code'])
    })

    it('resend for a verified address cannot be used to reset its password', async () => {
      const { email } = await signUp()
      await resend(email, PASSWORD_2)
      expect(mail.codesFor(email)).toHaveLength(1)
      expect((await login(email, PASSWORD)).status).toBe(200)
      expect(errorCode(await login(email, PASSWORD_2))).toBe('invalid_credentials')
    })

    it('per-email code-request limit: 3 per 15 min → 429 with Retry-After', async () => {
      const email = freshEmail()
      expect((await register(email)).status).toBe(202) // 1
      expect((await resend(email)).status).toBe(202) // 2
      expect((await resend(email)).status).toBe(202) // 3
      const r = await resend(email)
      expect(r.status).toBe(429)
      expect(errorCode(r)).toBe('rate_limited')
      expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1)
      expect(mail.codesFor(email)).toHaveLength(3)
    })
  })

  // ------------------------------------------------------------------ password policy

  describe('password policy at registration', () => {
    async function accountDocs(): Promise<number> {
      const [users, emails, otp] = await Promise.all(['users_auth', 'auth_emails', 'otp_codes'].map((c) => adminDb().collection(c).get()))
      return (users?.size ?? 0) + (emails?.size ?? 0) + (otp?.size ?? 0)
    }

    it('breached password → breached_password, nothing created, no mail', async () => {
      const email = freshEmail()
      const r = await register(email, BREACHED)
      expect(r.status).toBe(400)
      expect(errorCode(r)).toBe('breached_password')
      expect(await accountDocs()).toBe(0)
      expect(mail.sent).toHaveLength(0)
    })

    it.each([['too short', 'short'], ['too long', 'x'.repeat(129)]])('%s → weak_password, nothing created', async (_l, pw) => {
      const r = await register(freshEmail(), pw)
      expect(r.status).toBe(400)
      expect(errorCode(r)).toBe('weak_password')
      expect(await accountDocs()).toBe(0)
      expect(mail.sent).toHaveLength(0)
    })
  })

  // ------------------------------------------------------------------ login & lockout

  describe('login', () => {
    it('wrong password and unknown email give identical status and body', async () => {
      const { email } = await signUp()
      const wrong = await login(email, PASSWORD_2)
      const unknown = await login(freshEmail(), PASSWORD_2)
      expect(wrong.status).toBe(401)
      expect(unknown.status).toBe(401)
      expect(errorCode(wrong)).toBe('invalid_credentials')
      expect(stableBody(wrong)).toEqual(stableBody(unknown))
      expect(wrong.setCookie).toBeUndefined()
      expect(unknown.setCookie).toBeUndefined()
    })

    it('a pending (unverified) registration cannot log in — same invalid_credentials', async () => {
      const email = freshEmail()
      await register(email)
      const r = await login(email)
      expect(stableBody(r)).toEqual(stableBody(await login(freshEmail())))
    })

    it('normalizes the address (case, spaces)', async () => {
      const { email } = await signUp()
      expect((await login(`  ${email.toUpperCase()} `)).status).toBe(200)
    })

    async function failUntilLocked(email: string): Promise<FakeResponse> {
      for (let i = 0; i < 4; i++) {
        const r = await login(email, PASSWORD_2)
        expect(r.status, `failure #${i + 1}`).toBe(401)
      }
      const fifth = await login(email, PASSWORD_2)
      // The 5th failure either answers 401 and the next attempt is locked, or itself locks.
      if (fifth.status === 429) return fifth
      expect(fifth.status).toBe(401)
      return login(email, PASSWORD_2)
    }

    it('5 failures → 429 rate_limited with Retry-After ≈ 15 min; even the correct password is refused', async () => {
      const { email } = await signUp()
      const locked = await failUntilLocked(email)
      expect(locked.status).toBe(429)
      expect(errorCode(locked)).toBe('rate_limited')
      const retry = Number(locked.headers['retry-after'])
      expect(retry).toBeGreaterThan(14 * 60)
      expect(retry).toBeLessThanOrEqual(15 * 60)

      const correct = await login(email, PASSWORD)
      expect(correct.status).toBe(429)
      expect(correct.setCookie).toBeUndefined()
    })

    it('after the lock expires the correct password works and resets the counter; the next lock doubles', async () => {
      const { email } = await signUp()
      await failUntilLocked(email)
      advance(15 * MINUTE + 1_000)
      expect((await login(email, PASSWORD)).status).toBe(200)
      // Counter reset: 4 more failures are still plain 401s.
      for (let i = 0; i < 4; i++) expect((await login(email, PASSWORD_2)).status).toBe(401)
    })

    it('a second lock (without a success in between) lasts twice as long', async () => {
      const { email } = await signUp()
      const first = await failUntilLocked(email)
      expect(Number(first.headers['retry-after'])).toBeLessThanOrEqual(15 * 60)
      advance(15 * MINUTE + 1_000)
      const second = await failUntilLocked(email)
      expect(second.status).toBe(429)
      const retry = Number(second.headers['retry-after'])
      expect(retry).toBeGreaterThan(29 * 60)
      expect(retry).toBeLessThanOrEqual(30 * 60)
      advance(16 * MINUTE)
      expect((await login(email, PASSWORD)).status).toBe(429) // still locked
      advance(15 * MINUTE)
      expect((await login(email, PASSWORD)).status).toBe(200)
    })

    it('unknown emails lock exactly like real ones (no enumeration via the lock)', async () => {
      const { email: real } = await signUp()
      const unknown = freshEmail()
      const a = await failUntilLocked(real)
      const b = await failUntilLocked(unknown)
      expect(a.status).toBe(429)
      expect(b.status).toBe(429)
      expect(stableBody(a)).toEqual(stableBody(b))
    })

    it('10 concurrent wrong logins: at most 5 get past the lock', async () => {
      const { email } = await signUp()
      const results = await Promise.all(Array.from({ length: 10 }, () => login(email, PASSWORD_2)))
      const notLimited = results.filter((r) => r.status !== 429)
      expect(notLimited.length).toBeLessThanOrEqual(5)
      for (const r of notLimited) expect(r.status).toBe(401)
      expect((await login(email, PASSWORD)).status).toBe(429)
    })

    it('timing: wrong password vs unknown email — medians within 50%', async () => {
      const { email } = await signUp()
      const key = emailKey(email)
      const RUNS = 15
      const existing: number[] = []
      const unknown: number[] = []
      const clearThrottle = async (k: string) => { await adminDb().collection('auth_throttle').doc(k).delete() }
      // Warm up both paths (dummy hash is computed lazily).
      await login(freshEmail(), PASSWORD_2)
      await login(email, PASSWORD_2)
      await clearThrottle(key)
      for (let i = 0; i < RUNS; i++) {
        const other = freshEmail()
        let t = performance.now()
        expect((await login(email, PASSWORD_2)).status).toBe(401)
        existing.push(performance.now() - t)
        t = performance.now()
        expect((await login(other, PASSWORD_2)).status).toBe(401)
        unknown.push(performance.now() - t)
        await clearThrottle(key)
      }
      const a = median(existing)
      const b = median(unknown)
      expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.5)
    }, 60_000)
  })

  // ------------------------------------------------------------------ sessions

  describe('sessions', () => {
    it('each login issues a new token; GET sessions lists both with a correct `current` flag and no secrets', async () => {
      const { email, token: t0 } = await signUp()
      const a = await login(email, PASSWORD)
      const b = await login(email, PASSWORD, { userAgent: UA_FIREFOX_LINUX })
      const ta = a.sessionToken as string
      const tb = b.sessionToken as string
      expect(new Set([t0, ta, tb]).size).toBe(3)

      const list = await call('GET', 'sessions', { cookie: ta })
      expect(list.status).toBe(200)
      const sessions = list.json.sessions as Array<Record<string, unknown>>
      expect(sessions).toHaveLength(3)
      expect(sessions.filter((s) => s.current)).toHaveLength(1)
      for (const s of sessions) {
        expect(Object.keys(s).sort()).toEqual(['createdAt', 'current', 'device', 'id', 'ipPrefix', 'lastSeenAt'])
        expect(s.id).toMatch(/^[0-9a-f]{32}$/)
        expect(s.ipPrefix).toMatch(/\.0$/)
      }
      expect(sessions.map((s) => s.device)).toEqual(expect.arrayContaining(['Firefox · Linux', 'Chrome · Windows']))
      for (const t of [t0, ta, tb]) expect(list.text).not.toContain(t)
      const { sha256Hex } = await import('../../server/auth/crypto.js')
      for (const t of [t0, ta, tb]) expect(list.text).not.toContain(sha256Hex(t))

      // From session B's point of view, B is current.
      const fromB = (await call('GET', 'sessions', { cookie: tb })).json.sessions as Array<Record<string, unknown>>
      const currentB = fromB.find((s) => s.current)
      expect(currentB?.device).toBe('Firefox · Linux')
    })

    it('login with an old cookie presented ends that old session', async () => {
      const { email, token: old } = await signUp()
      const fresh = await login(email, PASSWORD, { cookie: old })
      expect(fresh.status).toBe(200)
      expect(fresh.sessionToken).not.toBe(old)
      expect((await call('GET', 'me', { cookie: old })).status).toBe(401)
      expect((await call('GET', 'me', { cookie: fresh.sessionToken })).status).toBe(200)
    })

    it('DELETE sessions/:id of another device → that cookie is dead; mine survives', async () => {
      const { email, token: mine } = await signUp()
      const other = (await login(email, PASSWORD, { userAgent: UA_FIREFOX_LINUX })).sessionToken as string
      const list = (await call('GET', 'sessions', { cookie: mine })).json.sessions as Array<{ id: string; current: boolean }>
      const target = list.find((s) => !s.current)
      expect(target).toBeDefined()
      const del = await call('DELETE', `sessions/${target!.id}`, { cookie: mine })
      expect(del.status).toBe(200)
      expect(del.json).toEqual({ ok: true })
      expect(del.setCookie).toBeUndefined()
      expect((await call('GET', 'me', { cookie: other })).status).toBe(401)
      expect((await call('GET', 'me', { cookie: mine })).status).toBe(200)
    })

    it('DELETE of the current session clears the cookie', async () => {
      const { token } = await signUp()
      const list = (await call('GET', 'sessions', { cookie: token })).json.sessions as Array<{ id: string; current: boolean }>
      const del = await call('DELETE', `sessions/${list[0]!.id}`, { cookie: token })
      expect(del.status).toBe(200)
      expect(del.setCookie).toMatch(/^__Host-session=;/)
      expect(del.setCookie).toContain('Max-Age=0')
      expect((await call('GET', 'me', { cookie: token })).status).toBe(401)
    })

    it('a session id of another user → 404 and that session survives', async () => {
      const alice = await signUp()
      const bob = await signUp()
      const bobs = (await call('GET', 'sessions', { cookie: bob.token })).json.sessions as Array<{ id: string }>
      const r = await call('DELETE', `sessions/${bobs[0]!.id}`, { cookie: alice.token })
      expect(r.status).toBe(404)
      expect((await call('GET', 'me', { cookie: bob.token })).status).toBe(200)
      expect((await call('DELETE', 'sessions/not-an-id', { cookie: alice.token })).status).toBe(404)
    })

    it('idle expiry: 7 days without activity → 401', async () => {
      const { token } = await signUp()
      advance(7 * DAY - MINUTE)
      expect((await call('GET', 'me', { cookie: token })).status).toBe(200) // activity refreshes idle
      advance(7 * DAY + 1)
      expect((await call('GET', 'me', { cookie: token })).status).toBe(401)
    })

    it('absolute expiry: 30 days even with regular activity → 401', async () => {
      const { token } = await signUp()
      for (let day = 6; day <= 24; day += 6) {
        advance(6 * DAY)
        expect((await call('GET', 'me', { cookie: token })).status, `day ${day}`).toBe(200)
      }
      advance(6 * DAY) // day 30: idle window would still allow until day 31
      expect((await call('GET', 'me', { cookie: token })).status).toBe(401)
    })

    it('session cookie Max-Age is 30 days', async () => {
      const { email } = await signUp()
      const r = await login(email)
      expect(r.setCookie).toContain(`Max-Age=${30 * 24 * 3600}`)
    })
  })

  // ------------------------------------------------------------------ logout & revocation

  describe('logout', () => {
    async function bridgeUser(uid: string): Promise<string | undefined> {
      // Make the Firebase Auth user exist (as after a bridge sign-in) and return its tokensValidAfterTime.
      await adminAuth().createUser({ uid }).catch(() => undefined)
      return (await adminAuth().getUser(uid)).tokensValidAfterTime
    }

    async function validAfterMovesOn(uid: string, action: () => Promise<void>): Promise<void> {
      const before = await bridgeUser(uid)
      await new Promise((r) => setTimeout(r, 1_100)) // tokensValidAfterTime has 1-second resolution
      await action()
      const after = (await adminAuth().getUser(uid)).tokensValidAfterTime
      expect(after).toBeTruthy()
      if (before) expect(Date.parse(after as string)).toBeGreaterThan(Date.parse(before))
    }

    it('logout clears the cookie, kills the token and revokes Firebase refresh tokens', async () => {
      const { token, uid } = await signUp()
      await validAfterMovesOn(uid, async () => {
        const r = await call('POST', 'logout', { cookie: token })
        expect(r.status).toBe(200)
        expect(r.json).toEqual({ ok: true })
        expect(r.setCookie).toMatch(/^__Host-session=;.*Max-Age=0/)
      })
      expect((await call('GET', 'me', { cookie: token })).status).toBe(401)
    })

    it('logout without a session still answers ok and clears the cookie', async () => {
      const r = await call('POST', 'logout')
      expect(r.status).toBe(200)
      expect(r.setCookie).toContain('Max-Age=0')
    })

    it('DELETE sessions/:id revokes Firebase refresh tokens too', async () => {
      const { email, token: mine, uid } = await signUp()
      await login(email, PASSWORD, { userAgent: UA_FIREFOX_LINUX })
      const list = (await call('GET', 'sessions', { cookie: mine })).json.sessions as Array<{ id: string; current: boolean }>
      const target = list.find((s) => !s.current)!
      await validAfterMovesOn(uid, async () => {
        expect((await call('DELETE', `sessions/${target.id}`, { cookie: mine })).status).toBe(200)
      })
    })

    it('logout-all kills every session, revokes refresh tokens, and no new bridge token can be minted', async () => {
      const { email, token: t1, uid } = await signUp()
      const t2 = (await login(email, PASSWORD, { userAgent: UA_FIREFOX_LINUX })).sessionToken as string
      await validAfterMovesOn(uid, async () => {
        const r = await call('POST', 'logout-all', { cookie: t1 })
        expect(r.status).toBe(200)
        expect(r.setCookie).toContain('Max-Age=0')
      })
      for (const t of [t1, t2]) {
        expect((await call('GET', 'me', { cookie: t })).status).toBe(401)
        expect((await call('POST', 'firebase-token', { cookie: t })).status).toBe(401)
      }
    })

    it('logout-all without a session → 401', async () => {
      expect((await call('POST', 'logout-all')).status).toBe(401)
    })
  })

  // ------------------------------------------------------------------ CSRF & logs

  describe('cross-cutting', () => {
    it.each(['register', 'login', 'verify-email', 'logout', 'logout-all', 'firebase-token'])('POST %s without Origin → 403', async (path) => {
      const r = await call('POST', path, { origin: null, body: { email: freshEmail(), password: PASSWORD, code: '123456' } })
      expect(r.status).toBe(403)
      expect(errorCode(r)).toBe('origin_rejected')
    })

    it('POST register from a foreign Origin → 403 and nothing is created', async () => {
      const r = await call('POST', 'register', { origin: 'https://evil.example', body: { email: freshEmail(), password: PASSWORD } })
      expect(r.status).toBe(403)
      expect(mail.sent).toHaveLength(0)
      expect((await adminDb().collection('otp_codes').get()).size).toBe(0)
    })

    it('no secrets in logs during a full flow (password, code, session token, custom token)', async () => {
      const lines: string[] = []
      const restore = captureLogs((l) => lines.push(l))
      const secrets: string[] = [PASSWORD, PASSWORD_2]
      try {
        const email = freshEmail()
        await register(email)
        const code = mail.lastCode(email)
        secrets.push(code)
        await verify(email, otherCode(code))
        const v = await verify(email, code)
        secrets.push(v.sessionToken as string)
        await login(email, PASSWORD_2)
        const l = await login(email, PASSWORD)
        secrets.push(l.sessionToken as string)
        const ft = await call('POST', 'firebase-token', { cookie: l.sessionToken })
        secrets.push(ft.json.token as string)
        await call('GET', 'sessions', { cookie: l.sessionToken })
        await call('POST', 'logout-all', { cookie: l.sessionToken })
      } finally {
        restore()
      }
      expect(lines.length).toBeGreaterThan(5)
      const all = lines.join('\n')
      for (const s of secrets) {
        expect(s.length).toBeGreaterThan(5)
        expect(all).not.toContain(s)
      }
      // The custom token payload must not leak either (its signature-less parts are long base64).
      const custom = secrets[secrets.length - 1] as string
      for (const part of custom.split('.').filter((p) => p.length > 20)) expect(all).not.toContain(part)
      expect(jwtPayload(custom).uid).toBeTruthy()
    })
  })
})
