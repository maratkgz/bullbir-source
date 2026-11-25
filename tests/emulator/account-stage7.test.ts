// Stage 7 — password reset, password change, email change and account deletion, driven through the
// real router against the Firestore + Auth emulators (project "demo-bullbir" only).
// Codes are bound to the browser that asked for them (HttpOnly `__Host-otp`), so the tests drive
// "browsers": a cookie jar + a fixed IP + a user agent.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp as deleteAdminApp, getApps as getAdminApps } from 'firebase-admin/app'
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, inMemoryPersistence, initializeAuth, signInWithCustomToken } from 'firebase/auth'
import { connectFirestoreEmulator, doc, getDoc, initializeFirestore, terminate } from 'firebase/firestore'
import { resetEnvForTests } from '../../server/env.js'
import { adminAuth, adminDb } from '../../server/firebaseAdmin.js'
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
  AUTH_HOST,
  EMULATORS_RUNNING,
  errorCode,
  FIRESTORE_HOST,
  jwtPayload,
  MailBox,
  nextIp,
  ORIGIN,
  PROJECT_ID,
  resetEmulators,
  TEST_ENV,
  UA_CHROME_WIN,
  type FakeResponse,
} from './helpers/authHarness.js'

const MINUTE = 60_000
const COOLDOWN = 61_000 // 1 code request per minute (per address+IP, or per account for email change)
const PASSWORD = 'correct horse battery staple'
const NEW_PASSWORD = 'a brand new passphrase 42'
const WRONG_PASSWORD = 'definitely not the password'
const BREACHED = 'password123456'
const CODE_SENT = { status: 'code_sent' }
const OTP_COOKIE = /^__Host-otp=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=600$/
const OTP_CLEARED = /^__Host-otp=;.*Max-Age=0/
const SESSION_SET = /^__Host-session=[A-Za-z0-9_-]{43};/
const SESSION_CLEARED = /^__Host-session=;.*Max-Age=0/

type Res = FakeResponse & { cookies: string[] }
type CodeKind = 'login-code' | 'reset-code' | 'email-change-code'

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

/** A different valid 8-digit code. */
function otherCode8(code: string): string {
  return String((Number(code) + 1) % 100_000_000).padStart(8, '0')
}

const suite = EMULATORS_RUNNING ? describe : describe.skip

suite('stage 7 — account operations (emulator)', () => {
  let savedEnv: Record<string, string | undefined>
  let handler: ReturnType<typeof createHandler>
  let mail: MailBox
  let clockMs: number
  let seq = 0
  let restoreQuietLogs: () => void = () => undefined

  const freshEmail = (): string => normalizeEmail(`acct${Date.now()}x${++seq}@example.test`)
  const freshUid = (): string => `Acc${Date.now()}${++seq}`.padEnd(28, 'x').slice(0, 28)
  const advance = (ms: number): void => { clockMs += ms }
  const db = () => adminDb()
  const authDoc = async (uid: string) => (await db().collection('users_auth').doc(uid).get()).data() ?? {}

  const call = (b: Browser, method: string, path: string, body?: unknown): Promise<Res> => send(handler, b, method, path, body)
  const login = (email: string, password: string, b = new Browser()): Promise<Res> => call(b, 'POST', 'login', { email, password })
  const meStatus = async (session: string | undefined): Promise<number> => {
    const b = new Browser()
    b.session = session
    return (await call(b, 'GET', 'me')).status
  }

  // routes under test
  const resetRequest = (b: Browser, email: string) => call(b, 'POST', 'password/reset-request', { email })
  const resetConfirm = (b: Browser, email: string, code: string, newPassword = NEW_PASSWORD) =>
    call(b, 'POST', 'password/reset-confirm', { email, code, newPassword })
  const changePassword = (b: Browser, currentPassword: string, newPassword = NEW_PASSWORD) =>
    call(b, 'POST', 'password/change', { currentPassword, newPassword })
  const emailChangeRequest = (b: Browser, newEmail: string, currentPassword?: string) =>
    call(b, 'POST', 'email/change-request', currentPassword === undefined ? { newEmail } : { newEmail, currentPassword })
  const emailChangeConfirm = (b: Browser, newEmail: string, code: string) =>
    call(b, 'POST', 'email/change-confirm', { newEmail, code })
  const deleteAccount = (b: Browser, currentPassword?: string) =>
    call(b, 'POST', 'account/delete', currentPassword === undefined ? {} : { currentPassword })

  function mailsOf<K extends AuthMail['kind']>(kind: K, to: string): Extract<AuthMail, { kind: K }>[] {
    return mail.sent.flatMap((m) => (m.kind === kind && m.to === to ? [m as Extract<AuthMail, { kind: K }>] : []))
  }
  function lastCode(kind: CodeKind, to: string): string {
    const list = mailsOf(kind, to)
    const last = list[list.length - 1]
    if (!last) throw new Error(`no ${kind} mailed to ${to}`)
    return last.code
  }

  type Seeded = { uid: string; email: string }

  /** Writes users_auth + auth_emails directly. `passwordless`: no password hash. */
  async function seedUser(opts: {
    email?: string; emailVerified?: boolean; status?: string; legacy?: boolean; providers?: string[]; passwordless?: boolean
  } = {}): Promise<Seeded> {
    const uid = freshUid()
    const email = opts.email ?? freshEmail()
    const ts = new Date(clockMs)
    await db().collection('auth_emails').doc(emailKey(email)).create({ uid, createdAt: ts })
    await db().collection('users_auth').doc(uid).create({
      email,
      emailVerified: opts.emailVerified ?? true,
      passwordHash: opts.passwordless ? null : await hashPassword(PASSWORD),
      legacyPassword: opts.legacy ? { hash: 'bGVnYWN5LWhhc2g=', salt: 'bGVnYWN5LXNhbHQ=' } : null,
      displayName: 'Seeded User',
      providers: opts.providers ?? (opts.passwordless ? ['google.com'] : ['password']),
      status: opts.status ?? 'active',
      createdAt: ts,
      updatedAt: ts,
      lastLoginAt: null,
      passwordChangedAt: null,
    })
    return { uid, email }
  }

  /** Session that bypasses login (for accounts whose password can't be used). */
  async function plantSession(uid: string): Promise<string> {
    const token = randomToken()
    const t = clockMs
    await db().collection('sessions').doc(sha256Hex(token)).create({
      uid,
      publicId: `planted-${++seq}`,
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

  /** A browser signed in with email + password. */
  async function signedIn(email: string, password = PASSWORD): Promise<Browser> {
    const b = new Browser()
    const r = await login(email, password, b)
    expect(r.status, r.text).toBe(200)
    expect(b.session).toBeTruthy()
    return b
  }

  /** A browser signed in with an emailed login code (session created "now"). */
  async function codeSignedIn(email: string): Promise<Browser> {
    const b = new Browser()
    expect((await call(b, 'POST', 'otp/request', { email })).status).toBe(202)
    const v = await call(b, 'POST', 'otp/verify', { email, code: lastCode('login-code', email) })
    expect(v.status, v.text).toBe(200)
    return b
  }

  async function failUntilLocked(email: string): Promise<Res> {
    for (let i = 0; i < 6; i++) {
      const r = await login(email, WRONG_PASSWORD)
      if (r.status === 429) return r
      expect(r.status, `failure #${i + 1}`).toBe(401)
    }
    throw new Error('never locked')
  }

  /** Makes the Firebase Auth user exist (as after a bridge sign-in / legacy import). */
  async function firebaseUser(uid: string, email?: string): Promise<string | undefined> {
    await adminAuth().createUser(email ? { uid, email } : { uid })
    return (await adminAuth().getUser(uid)).tokensValidAfterTime
  }

  /**
   * Exchanges a server-minted custom token with the client SDK and reads users/{uid}/tasks/t1
   * through the security rules. 'no-signin' = the exchange itself was refused.
   */
  async function readTaskAs(customToken: string, uid: string): Promise<'allowed' | 'denied' | 'no-signin'> {
    const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'fake-api-key' }, `acct-probe-${++seq}`)
    try {
      const auth = initializeAuth(app, { persistence: inMemoryPersistence })
      connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true })
      const fs = initializeFirestore(app, {})
      const [host, port] = String(FIRESTORE_HOST).split(':')
      connectFirestoreEmulator(fs, host as string, Number(port))
      try {
        await signInWithCustomToken(auth, customToken)
      } catch {
        return 'no-signin'
      }
      try {
        await getDoc(doc(fs, 'users', uid, 'tasks', 't1'))
        return 'allowed'
      } catch (err) {
        if ((err as { code?: string }).code === 'permission-denied') return 'denied'
        throw err
      } finally {
        await terminate(fs)
      }
    } finally {
      await deleteApp(app)
    }
  }

  /** tokensValidAfterTime has 1-second resolution: wait, act, compare. */
  async function expectFirebaseRevoked(uid: string, before: string | undefined, action: () => Promise<void>): Promise<void> {
    await new Promise((r) => setTimeout(r, 1_100))
    await action()
    const after = (await adminAuth().getUser(uid)).tokensValidAfterTime
    expect(after).toBeTruthy()
    if (before) expect(Date.parse(after as string)).toBeGreaterThan(Date.parse(before))
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
    setBreachCheckerForTests(async (p) => p === BREACHED) // never the real HIBP
    setMinResponseMsForTests(0)
    clockMs = Date.now()
    setClockForTests(() => clockMs)
    const limiter = new MemoryRateLimiter(() => clockMs) // same virtual clock as the server
    handler = createHandler(routes, { limiter: () => limiter })
  })

  afterEach(() => {
    setClockForTests(undefined)
    setMinResponseMsForTests(0)
    setBreachCheckerForTests(undefined)
    setMailerForTests(mail)
    restoreQuietLogs()
  })

  // ================================================================== 1. password reset

  describe('password reset', () => {
    it('request: same 202 + challenge cookie for existing, unknown and disabled; reset-code only for the existing active one', async () => {
      const real = await seedUser()
      const disabled = await seedUser({ status: 'disabled' })
      const unknown = freshEmail()
      const answers: Res[] = []
      for (const email of [real.email, unknown, disabled.email]) answers.push(await resetRequest(new Browser(), email))
      for (const r of answers) {
        expect(r.status).toBe(202)
        expect(r.json).toEqual(CODE_SENT)
        expect(r.text).toBe(answers[0]!.text)
        expect(r.cookies).toHaveLength(1)
        expect(r.cookies[0]).toMatch(OTP_COOKIE)
        expect(r.sessionToken).toBeUndefined()
      }
      expect(new Set(answers.map((r) => r.cookies[0])).size).toBe(3)
      expect(mail.kindsFor(real.email)).toEqual(['reset-code'])
      expect(mail.kindsFor(unknown)).toEqual([])
      expect(mail.kindsFor(disabled.email)).toEqual([])
      expect(mail.sent).toHaveLength(1)
      const sent = mailsOf('reset-code', real.email)[0]!
      expect(sent.code).toMatch(/^\d{8}$/)
      expect(answers[0]!.text).not.toContain(sent.code)
      const codes = await db().collection('otp_codes').get()
      expect(codes.size).toBe(1)
      expect(codes.docs[0]!.get('purpose')).toBe('reset')
    })

    it('confirm: new password + fresh session; all old sessions, old password and Firebase tokens end; lockout lifted; password-changed mail', async () => {
      const u = await seedUser()
      const before = await firebaseUser(u.uid)
      const s1 = await signedIn(u.email)
      const s2 = await signedIn(u.email)
      const pendingEmail = freshEmail()
      expect((await emailChangeRequest(s1, pendingEmail, PASSWORD)).status).toBe(202) // a pending change_email code
      const pendingChange = lastCode('email-change-code', pendingEmail)
      await failUntilLocked(u.email)
      expect((await login(u.email, PASSWORD)).status).toBe(429) // locked even for the owner

      const b = new Browser()
      let r!: Res
      await expectFirebaseRevoked(u.uid, before, async () => {
        expect((await resetRequest(b, u.email)).status).toBe(202)
        expect(b.otp).toBeTruthy()
        r = await resetConfirm(b, u.email, lastCode('reset-code', u.email))
      })
      expect(r.status, r.text).toBe(200)
      expect(r.json.user).toMatchObject({ uid: u.uid, email: u.email, emailVerified: true })
      expect(r.setCookie).toMatch(SESSION_SET)
      expect(r.cookies.some((c) => OTP_CLEARED.test(c))).toBe(true)
      expect(b.otp).toBeUndefined()
      expect(r.text).not.toMatch(/hash|argon/i)

      expect(await meStatus(b.session)).toBe(200)
      expect(await meStatus(s1.session)).toBe(401)
      expect(await meStatus(s2.session)).toBe(401)
      expect((await db().collection('sessions').where('uid', '==', u.uid).get()).size).toBe(1)
      expect((await db().collection('auth_throttle').doc(emailKey(u.email)).get()).exists).toBe(false)
      expect((await db().collection('otp_codes').get()).size).toBe(0) // used code + pending email-change code
      const fresh = new Browser()
      fresh.session = b.session
      fresh.otp = s1.otp
      expect(errorCode(await emailChangeConfirm(fresh, pendingEmail, pendingChange))).toBe('invalid_code')

      const doc = await authDoc(u.uid)
      expect(doc.passwordHash).toMatch(/^\$argon2id\$/)
      expect(doc.passwordChangedAt).toBeTruthy()

      expect(mail.kindsFor(u.email)).toEqual(['reset-code', 'password-changed'])
      const notice = mailsOf('password-changed', u.email)[0]!
      expect(notice.device).toBeTruthy()
      expect(notice.at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/)

      const old = await login(u.email, PASSWORD)
      expect(old.status).toBe(401) // not 429: the lock is gone
      expect(errorCode(old)).toBe('invalid_credentials')
      expect((await login(u.email, NEW_PASSWORD)).status).toBe(200)
    })

    it('credential version: a bridge token minted before the reset can no longer read users/{uid}/**; one minted after can', async () => {
      const u = await seedUser()
      await db().collection('users').doc(u.uid).collection('tasks').doc('t1').set({ title: 'secret task' })
      const b = await signedIn(u.email)
      const mint = async (br: Browser): Promise<string> => {
        const r = await call(br, 'POST', 'firebase-token')
        expect(r.status, r.text).toBe(200)
        return r.json.token as string
      }
      const control = await mint(b)
      expect((jwtPayload(control).claims as { bb_cv?: unknown }).bb_cv).toBe(0) // no auth_state yet
      expect(await readTaskAs(control, u.uid)).toBe('allowed') // the probe itself works
      const stale = await mint(b)

      advance(1_000)
      const rb = new Browser()
      await resetRequest(rb, u.email)
      expect((await resetConfirm(rb, u.email, lastCode('reset-code', u.email))).status).toBe(200)
      const cv = Number((await db().collection('auth_state').doc(u.uid).get()).get('cv'))
      expect(cv).toBeGreaterThan(0)

      expect(await readTaskAs(stale, u.uid)).not.toBe('allowed')
      const fresh = await mint(rb)
      expect(Number((jwtPayload(fresh).claims as { bb_cv?: unknown }).bb_cv)).toBeGreaterThanOrEqual(cv)
      expect(await readTaskAs(fresh, u.uid)).toBe('allowed')
    })

    it('confirm without the challenge cookie → invalid_code, nothing consumed; the owner can still confirm', async () => {
      const u = await seedUser()
      const owner = new Browser()
      await resetRequest(owner, u.email)
      const code = lastCode('reset-code', u.email)
      const bare = new Browser()
      const r = await resetConfirm(bare, u.email, code)
      expect(r.status).toBe(400)
      expect(errorCode(r)).toBe('invalid_code')
      expect(r.sessionToken).toBeUndefined()
      expect((await db().collection('otp_codes').get()).docs[0]!.get('attempts')).toBe(0)
      expect((await login(u.email, PASSWORD)).status).toBe(200)
      expect((await resetConfirm(owner, u.email, code)).status).toBe(200)
    })

    it('confirm with another browser’s challenge cookie → invalid_code', async () => {
      const u = await seedUser()
      const owner = new Browser()
      await resetRequest(owner, u.email)
      const code = lastCode('reset-code', u.email)
      const other = new Browser()
      await resetRequest(other, freshEmail()) // a valid cookie of its own, for some other address
      expect(other.otp).toBeTruthy()
      const r = await resetConfirm(other, u.email, code)
      expect(errorCode(r)).toBe('invalid_code')
      expect(r.sessionToken).toBeUndefined()
      // An attacker who also requested for the same address holds a different challenge.
      const attacker = new Browser()
      await resetRequest(attacker, u.email)
      expect(errorCode(await resetConfirm(attacker, u.email, code))).toBe('invalid_code')
      expect((await login(u.email, PASSWORD)).status).toBe(200)
      expect((await resetConfirm(owner, u.email, code)).status).toBe(200)
    })

    it('wrong code → invalid_code (challenge kept); the right code still works', async () => {
      const u = await seedUser()
      const b = new Browser()
      await resetRequest(b, u.email)
      const code = lastCode('reset-code', u.email)
      const bad = await resetConfirm(b, u.email, otherCode8(code))
      expect(bad.status).toBe(400)
      expect(errorCode(bad)).toBe('invalid_code')
      expect(bad.cookies).toHaveLength(0)
      expect((await login(u.email, PASSWORD)).status).toBe(200)
      expect((await resetConfirm(b, u.email, code)).status).toBe(200)
    })

    it('expired code (10 min) → invalid_code; password unchanged', async () => {
      const u = await seedUser()
      const b = new Browser()
      await resetRequest(b, u.email)
      advance(10 * MINUTE + 1)
      const r = await resetConfirm(b, u.email, lastCode('reset-code', u.email))
      expect(errorCode(r)).toBe('invalid_code')
      expect(r.sessionToken).toBeUndefined()
      expect((await login(u.email, PASSWORD)).status).toBe(200)
    })

    it('reused code → invalid_code (even with the challenge re-presented)', async () => {
      const u = await seedUser()
      const b = new Browser()
      await resetRequest(b, u.email)
      const challenge = b.otp
      const code = lastCode('reset-code', u.email)
      expect((await resetConfirm(b, u.email, code)).status).toBe(200)
      b.otp = challenge
      const again = await resetConfirm(b, u.email, code, 'yet another passphrase 7')
      expect(errorCode(again)).toBe('invalid_code')
      expect(again.sessionToken).toBeUndefined()
      expect((await login(u.email, NEW_PASSWORD)).status).toBe(200)
    })

    it('a code for another address does not work', async () => {
      const x = await seedUser()
      const y = await seedUser()
      const b = new Browser()
      await resetRequest(b, x.email)
      expect(errorCode(await resetConfirm(b, y.email, lastCode('reset-code', x.email)))).toBe('invalid_code')
      expect((await login(y.email, PASSWORD)).status).toBe(200)
    })

    it('short / breached new password → weak_password / breached_password before the code is consumed', async () => {
      const u = await seedUser()
      const b = new Browser()
      await resetRequest(b, u.email)
      const code = lastCode('reset-code', u.email)
      const short = await resetConfirm(b, u.email, code, 'short')
      expect(short.status).toBe(400)
      expect(errorCode(short)).toBe('weak_password')
      const breached = await resetConfirm(b, u.email, code, BREACHED)
      expect(breached.status).toBe(400)
      expect(errorCode(breached)).toBe('breached_password')
      const stored = await db().collection('otp_codes').get()
      expect(stored.size).toBe(1)
      expect(stored.docs[0]!.get('attempts')).toBe(0)
      expect(b.otp).toBeTruthy()
      const ok = await resetConfirm(b, u.email, code)
      expect(ok.status, ok.text).toBe(200)
      expect((await login(u.email, NEW_PASSWORD)).status).toBe(200)
    })

    it('unverified imported account: reset confirms it, wipes old credentials, links and sessions', async () => {
      const u = await seedUser({ emailVerified: false, legacy: true, providers: ['google.com', 'password'] })
      const link = db().collection('auth_accounts').doc('google.com:squatter-sub')
      await link.create({ uid: u.uid, provider: 'google.com', email: 'squatter@gmail.test', linkedAt: new Date() })
      const otherLink = db().collection('auth_accounts').doc('google.com:someone-else')
      await otherLink.create({ uid: 'SomeoneElseUid0000000000000', provider: 'google.com', email: 'x@gmail.test', linkedAt: new Date() })
      const planted = await plantSession(u.uid)
      expect(await meStatus(planted)).toBe(200)

      const b = new Browser()
      await resetRequest(b, u.email)
      const r = await resetConfirm(b, u.email, lastCode('reset-code', u.email))
      expect(r.status, r.text).toBe(200)
      expect(r.json.user).toMatchObject({ uid: u.uid, emailVerified: true, providers: ['password'] })

      const doc = await authDoc(u.uid)
      expect(doc.emailVerified).toBe(true)
      expect(doc.passwordHash).toMatch(/^\$argon2id\$/)
      expect(doc.legacyPassword).toBeNull()
      expect(doc.providers).toEqual(['password'])
      expect((await link.get()).exists).toBe(false)
      expect((await db().collection('auth_accounts').where('uid', '==', u.uid).get()).size).toBe(0)
      expect((await otherLink.get()).exists).toBe(true)
      expect(await meStatus(planted)).toBe(401)
      expect(await meStatus(b.session)).toBe(200)
      expect((await login(u.email, NEW_PASSWORD)).status).toBe(200)
    })

    it('a reset code requested before an email change does not work for the old address afterwards', async () => {
      const u = await seedUser()
      const resetBrowser = new Browser()
      await resetRequest(resetBrowser, u.email)
      const resetCode = lastCode('reset-code', u.email)

      const b = await signedIn(u.email)
      const newEmail = freshEmail()
      expect((await emailChangeRequest(b, newEmail, PASSWORD)).status).toBe(202)
      expect((await emailChangeConfirm(b, newEmail, lastCode('email-change-code', newEmail))).status).toBe(200)

      const r = await resetConfirm(resetBrowser, u.email, resetCode)
      expect(errorCode(r)).toBe('invalid_code')
      expect(r.sessionToken).toBeUndefined()
      expect((await login(newEmail, PASSWORD)).status).toBe(200)
    })
  })

  // ================================================================== 2. password change

  describe('password change', () => {
    it('wrong current password → invalid_credentials, counted by the lockout (5th → 429)', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      for (let i = 0; i < 4; i++) {
        const r = await changePassword(b, WRONG_PASSWORD)
        expect(r.status, `attempt ${i + 1}`).toBe(401)
        expect(errorCode(r)).toBe('invalid_credentials')
      }
      const fifth = await changePassword(b, WRONG_PASSWORD)
      expect(fifth.status).toBe(429)
      expect(errorCode(fifth)).toBe('rate_limited')
      expect(Number(fifth.headers['retry-after'])).toBeGreaterThanOrEqual(1)
      // Locked: even the right current password and a plain login are refused now.
      expect((await changePassword(b, PASSWORD)).status).toBe(429)
      expect((await login(u.email, PASSWORD)).status).toBe(429)
      expect(await meStatus(b.session)).toBe(200) // the session itself survives
      expect((await authDoc(u.uid)).passwordChangedAt).toBeNull()
    })

    it('failures from password change and from login share one counter', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      for (let i = 0; i < 3; i++) expect((await login(u.email, WRONG_PASSWORD)).status).toBe(401)
      expect((await changePassword(b, WRONG_PASSWORD)).status).toBe(401)
      expect((await changePassword(b, WRONG_PASSWORD)).status).toBe(429)
    })

    it('account without a password → password_not_set (Google-only, and an unverified account claimed by a code login)', async () => {
      const g = await seedUser({ passwordless: true })
      const gb = await codeSignedIn(g.email)
      const r = await changePassword(gb, 'anything at all here')
      expect(r.status).toBe(400)
      expect(errorCode(r)).toBe('password_not_set')

      const imported = await seedUser({ emailVerified: false })
      const ib = await codeSignedIn(imported.email) // claimUnverifiedAccount wipes the password
      expect((await authDoc(imported.uid)).passwordHash).toBeNull()
      const r2 = await changePassword(ib, PASSWORD)
      expect(errorCode(r2)).toBe('password_not_set')
      expect(await meStatus(ib.session)).toBe(200)

      // Reset is the way to set one.
      const rb = new Browser()
      await resetRequest(rb, g.email)
      expect((await resetConfirm(rb, g.email, lastCode('reset-code', g.email))).status).toBe(200)
      expect((await login(g.email, NEW_PASSWORD)).status).toBe(200)
    })

    it('weak / breached new password → rejected, nothing changes', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      expect(errorCode(await changePassword(b, PASSWORD, 'short'))).toBe('weak_password')
      expect(errorCode(await changePassword(b, PASSWORD, BREACHED))).toBe('breached_password')
      expect(await meStatus(b.session)).toBe(200)
      expect((await login(u.email, PASSWORD)).status).toBe(200)
    })

    it('requires a session', async () => {
      const r = await changePassword(new Browser(), PASSWORD)
      expect(r.status).toBe(401)
      expect(errorCode(r)).toBe('unauthorized')
    })

    it('success: this browser gets a new working session, other sessions end, old password fails, password-changed mail', async () => {
      const u = await seedUser()
      const before = await firebaseUser(u.uid)
      const other1 = await signedIn(u.email)
      const other2 = await signedIn(u.email)
      const b = await signedIn(u.email)
      const oldToken = b.session
      const pending = new Browser()
      await resetRequest(pending, u.email) // a pending reset code
      const pendingCode = lastCode('reset-code', u.email)
      let r!: Res
      await expectFirebaseRevoked(u.uid, before, async () => {
        r = await changePassword(b, PASSWORD)
      })
      expect((await db().collection('otp_codes').where('data.uid', '==', u.uid).get()).size).toBe(0)
      expect(errorCode(await resetConfirm(pending, u.email, pendingCode, 'attacker chosen pass 1'))).toBe('invalid_code')
      expect(r.status, r.text).toBe(200)
      expect(r.json.user).toMatchObject({ uid: u.uid, email: u.email })
      expect(r.setCookie).toMatch(SESSION_SET)
      expect(b.session).toBeTruthy()
      expect(b.session).not.toBe(oldToken)
      expect(await meStatus(b.session)).toBe(200)
      expect(await meStatus(oldToken)).toBe(401)
      expect(await meStatus(other1.session)).toBe(401)
      expect(await meStatus(other2.session)).toBe(401)
      expect((await db().collection('sessions').where('uid', '==', u.uid).get()).size).toBe(1)
      expect(mail.kindsFor(u.email)).toEqual(['reset-code', 'password-changed'])
      const old = await login(u.email, PASSWORD)
      expect(old.status).toBe(401)
      expect(errorCode(old)).toBe('invalid_credentials')
      expect((await login(u.email, NEW_PASSWORD)).status).toBe(200)
    })
  })

  // ================================================================== 3. email change

  describe('email change', () => {
    it('password account: current password required (missing / wrong → invalid_credentials); then the code goes to the NEW address', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      const newEmail = freshEmail()
      const missing = await emailChangeRequest(b, newEmail)
      expect(missing.status).toBe(401)
      expect(errorCode(missing)).toBe('invalid_credentials')
      advance(COOLDOWN)
      const wrong = await emailChangeRequest(b, newEmail, WRONG_PASSWORD)
      expect(wrong.status).toBe(401)
      expect(errorCode(wrong)).toBe('invalid_credentials')
      expect(mail.sent).toHaveLength(0)
      expect(b.otp).toBeUndefined()

      advance(COOLDOWN)
      const ok = await emailChangeRequest(b, newEmail, PASSWORD)
      expect(ok.status, ok.text).toBe(202)
      expect(ok.json).toEqual(CODE_SENT)
      expect(ok.cookies).toHaveLength(1)
      expect(ok.cookies[0]).toMatch(OTP_COOKIE)
      expect(mail.kindsFor(newEmail)).toEqual(['email-change-code'])
      expect(mail.kindsFor(u.email)).toEqual([])
      expect(lastCode('email-change-code', newEmail)).toMatch(/^\d{8}$/)
      expect(ok.text).not.toContain(lastCode('email-change-code', newEmail))
      // Nothing moved yet.
      expect((await authDoc(u.uid)).email).toBe(u.email)
    })

    it('passwordless account → password_not_set (even with a fresh session); after setting one via reset it works', async () => {
      const u = await seedUser({ passwordless: true })
      const b = await codeSignedIn(u.email) // brand-new session
      const newEmail = freshEmail()
      for (const pw of [undefined, 'anything at all here']) {
        advance(COOLDOWN)
        const r = await emailChangeRequest(b, newEmail, pw)
        expect(r.status, r.text).toBe(400)
        expect(errorCode(r)).toBe('password_not_set')
      }
      expect(mail.kindsFor(newEmail)).toEqual([])
      expect(b.otp).toBeUndefined()

      const rb = new Browser()
      await resetRequest(rb, u.email)
      expect((await resetConfirm(rb, u.email, lastCode('reset-code', u.email))).status).toBe(200)
      advance(COOLDOWN)
      const ok = await emailChangeRequest(rb, newEmail, NEW_PASSWORD)
      expect(ok.status, ok.text).toBe(202)
      expect(mail.kindsFor(newEmail)).toEqual(['email-change-code'])
      const c = await emailChangeConfirm(rb, newEmail, lastCode('email-change-code', newEmail))
      expect(c.status, c.text).toBe(200)
      expect((await authDoc(u.uid)).email).toBe(newEmail)
    })

    it('address that appears only in legacy Firebase Auth between request and confirm → invalid_code', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      const newEmail = freshEmail()
      expect((await emailChangeRequest(b, newEmail, PASSWORD)).status).toBe(202)
      const code = lastCode('email-change-code', newEmail)
      await adminAuth().createUser({ email: newEmail })
      const r = await emailChangeConfirm(b, newEmail, code)
      expect(r.status).toBe(400)
      expect(errorCode(r)).toBe('invalid_code')
      expect((await authDoc(u.uid)).email).toBe(u.email)
      expect((await db().collection('auth_emails').doc(emailKey(newEmail)).get()).exists).toBe(false)
    })

    it('taken new address → same 202 + cookie, already-registered notice to it, no code', async () => {
      const u = await seedUser()
      const taken = await seedUser()
      const b = await signedIn(u.email)
      const free = freshEmail()
      const normal = await emailChangeRequest(b, free, PASSWORD)
      advance(COOLDOWN)
      const r = await emailChangeRequest(b, taken.email, PASSWORD)
      expect(r.status).toBe(202)
      expect(r.text).toBe(normal.text)
      expect(r.cookies).toHaveLength(1)
      expect(r.cookies[0]).toMatch(OTP_COOKIE)
      expect(mail.kindsFor(taken.email)).toEqual(['already-registered'])
      expect(mail.kindsFor(u.email)).toEqual([])

      // Also an address that still lives only in Firebase Auth (imported, not yet migrated).
      const legacyEmail = freshEmail()
      await adminAuth().createUser({ email: legacyEmail })
      advance(COOLDOWN)
      const legacy = await emailChangeRequest(b, legacyEmail, PASSWORD)
      expect(legacy.status).toBe(202)
      expect(mail.kindsFor(legacyEmail)).toEqual(['already-registered'])

      const codes = await db().collection('otp_codes').where('purpose', '==', 'change_email').get()
      expect(codes.size).toBe(1) // only the one for the free address
    })

    it('confirm: account moves to the new address; old notified; other sessions end; login with new works, old fails', async () => {
      const u = await seedUser()
      const before = await firebaseUser(u.uid)
      await db().collection('users').doc(u.uid).set({ email: u.email, displayName: 'Profile Name', onboardingDone: true })
      const other = await signedIn(u.email)
      const b = await signedIn(u.email)
      const oldToken = b.session
      const newEmail = freshEmail()
      expect((await emailChangeRequest(b, newEmail, PASSWORD)).status).toBe(202)
      let r!: Res
      await expectFirebaseRevoked(u.uid, before, async () => {
        r = await emailChangeConfirm(b, newEmail, lastCode('email-change-code', newEmail))
      })
      expect(r.status, r.text).toBe(200)
      expect(r.json.user).toMatchObject({ uid: u.uid, email: newEmail, emailVerified: true })
      expect(r.setCookie).toMatch(SESSION_SET)
      expect(r.cookies.some((c) => OTP_CLEARED.test(c))).toBe(true)
      expect(b.otp).toBeUndefined()
      expect(b.session).not.toBe(oldToken)

      const doc = await authDoc(u.uid)
      expect(doc.email).toBe(newEmail)
      expect(doc.emailVerified).toBe(true)
      expect(doc.passwordChangedAt).toBeTruthy()
      expect(Number((await db().collection('auth_state').doc(u.uid).get()).get('cv'))).toBeGreaterThan(0)
      expect((await db().collection('auth_emails').doc(emailKey(u.email)).get()).exists).toBe(false)
      const idx = await db().collection('auth_emails').doc(emailKey(newEmail)).get()
      expect(idx.exists).toBe(true)
      expect(idx.get('uid')).toBe(u.uid)
      const profile = (await db().collection('users').doc(u.uid).get()).data() ?? {}
      expect(profile).toMatchObject({ email: newEmail, displayName: 'Profile Name', onboardingDone: true })

      const notice = mailsOf('email-changed', u.email)
      expect(notice).toHaveLength(1)
      expect(notice[0]!.newEmail).toBe(newEmail)
      expect(mail.kindsFor(newEmail)).toEqual(['email-change-code'])

      expect(await meStatus(b.session)).toBe(200)
      expect(await meStatus(oldToken)).toBe(401)
      expect(await meStatus(other.session)).toBe(401)
      expect((await login(newEmail, PASSWORD)).status).toBe(200)
      const old = await login(u.email, PASSWORD)
      expect(old.status).toBe(401)
      expect(errorCode(old)).toBe('invalid_credentials')
    })

    it('the code is bound to the requesting browser’s cookie (same session elsewhere / foreign cookie → invalid_code)', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      const newEmail = freshEmail()
      await emailChangeRequest(b, newEmail, PASSWORD)
      const code = lastCode('email-change-code', newEmail)

      const sameSessionNoCookie = new Browser()
      sameSessionNoCookie.session = b.session
      expect(errorCode(await emailChangeConfirm(sameSessionNoCookie, newEmail, code))).toBe('invalid_code')

      const foreign = new Browser()
      await resetRequest(foreign, freshEmail()) // some valid challenge cookie
      foreign.session = b.session
      expect(errorCode(await emailChangeConfirm(foreign, newEmail, code))).toBe('invalid_code')

      const wrong = await emailChangeConfirm(b, newEmail, otherCode8(code))
      expect(errorCode(wrong)).toBe('invalid_code')
      expect((await authDoc(u.uid)).email).toBe(u.email)

      const ok = await emailChangeConfirm(b, newEmail, code)
      expect(ok.status, ok.text).toBe(200)
    })

    it('a code issued for user A cannot be confirmed with user B’s session', async () => {
      const a = await seedUser()
      const bUser = await seedUser()
      const browserA = await signedIn(a.email)
      const browserB = await signedIn(bUser.email)
      const newEmail = freshEmail()
      await emailChangeRequest(browserA, newEmail, PASSWORD)
      const code = lastCode('email-change-code', newEmail)

      browserB.otp = browserA.otp // B even holds A's challenge cookie
      const r = await emailChangeConfirm(browserB, newEmail, code)
      expect(r.status).toBe(400)
      expect(errorCode(r)).toBe('invalid_code')
      expect((await authDoc(a.uid)).email).toBe(a.email)
      expect((await authDoc(bUser.uid)).email).toBe(bUser.email)
      expect((await db().collection('auth_emails').doc(emailKey(newEmail)).get()).exists).toBe(false)
      expect(await meStatus(browserB.session)).toBe(200)
    })

    it('address taken between request and confirm → invalid_code; nothing moves', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      const newEmail = freshEmail()
      await emailChangeRequest(b, newEmail, PASSWORD)
      const code = lastCode('email-change-code', newEmail)
      const squatter = await seedUser({ email: newEmail })

      const r = await emailChangeConfirm(b, newEmail, code)
      expect(r.status).toBe(400)
      expect(errorCode(r)).toBe('invalid_code')
      expect((await authDoc(u.uid)).email).toBe(u.email)
      expect((await db().collection('auth_emails').doc(emailKey(u.email)).get()).get('uid')).toBe(u.uid)
      expect((await db().collection('auth_emails').doc(emailKey(newEmail)).get()).get('uid')).toBe(squatter.uid)
      expect(mail.kindsFor(u.email)).toEqual([])
      expect(await meStatus(b.session)).toBe(200)
    })

    // BUG (server/auth/accountOps.ts changeAccountEmail): the Firebase Auth record keeps the OLD
    // email (imported accounts have one), and isAddressTaken() still treats an address known to
    // Firebase Auth as taken — so the released old address can never be registered again.
    it('after a change, the old address is free to register again (imported account with a Firebase Auth email)', async () => {
      const u = await seedUser()
      await firebaseUser(u.uid, u.email)
      const b = await signedIn(u.email)
      const newEmail = freshEmail()
      await emailChangeRequest(b, newEmail, PASSWORD)
      expect((await emailChangeConfirm(b, newEmail, lastCode('email-change-code', newEmail))).status).toBe(200)

      const reg = await call(new Browser(), 'POST', 'register', { email: u.email, password: NEW_PASSWORD })
      expect(reg.status).toBe(202)
      expect(mail.kindsFor(u.email)).toContain('verify-code')
    })
  })

  // ================================================================== 4. account deletion

  describe('account deletion', () => {
    it('password account: missing / wrong current password → invalid_credentials; nothing deleted', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      const missing = await deleteAccount(b)
      expect(missing.status).toBe(401)
      expect(errorCode(missing)).toBe('invalid_credentials')
      const wrong = await deleteAccount(b, WRONG_PASSWORD)
      expect(wrong.status).toBe(401)
      expect(errorCode(wrong)).toBe('invalid_credentials')
      expect((await db().collection('users_auth').doc(u.uid).get()).exists).toBe(true)
      expect(await meStatus(b.session)).toBe(200)
      expect(errorCode(await deleteAccount(new Browser(), PASSWORD))).toBe('unauthorized')
    })

    it('passwordless account → password_not_set (even with a fresh session); nothing deleted', async () => {
      const u = await seedUser({ passwordless: true })
      const b = await codeSignedIn(u.email)
      for (const pw of [undefined, 'anything at all here']) {
        const r = await deleteAccount(b, pw)
        expect(r.status, r.text).toBe(400)
        expect(errorCode(r)).toBe('password_not_set')
      }
      expect((await db().collection('users_auth').doc(u.uid).get()).exists).toBe(true)
      expect(await meStatus(b.session)).toBe(200)
      expect(mail.kindsFor(u.email)).not.toContain('account-deleted')
    })

    it('success: everything of the user is gone (data, records, codes, sessions, Firebase user); others untouched; the address can register again', async () => {
      const u = await seedUser()
      const v = await seedUser()
      await firebaseUser(u.uid, u.email)
      await firebaseUser(v.uid, v.email)
      for (const s of [u, v]) {
        await db().collection('users').doc(s.uid).set({ email: s.email, onboardingDone: true })
        await db().collection('users').doc(s.uid).collection('tasks').doc('t1').set({ title: 'task' })
        await db().collection('users').doc(s.uid).collection('habits').doc('h1').collection('log').doc('d1').set({ done: true })
        await db().collection('auth_accounts').doc(`google.com:sub-${s.uid}`).create({ uid: s.uid, provider: 'google.com', email: s.email, linkedAt: new Date() })
      }
      const other = await signedIn(u.email)
      const vSession = await signedIn(v.email)
      const b = await signedIn(u.email)
      await login(u.email, WRONG_PASSWORD) // an auth_throttle record for the address
      // Pending codes for both users: reset codes, and an email-change code for u.
      await resetRequest(new Browser(), u.email)
      await resetRequest(new Browser(), v.email)
      await emailChangeRequest(b, freshEmail(), PASSWORD)
      expect((await db().collection('otp_codes').where('data.uid', '==', u.uid).get()).size).toBe(2)

      const r = await deleteAccount(b, PASSWORD)
      expect(r.status, r.text).toBe(200)
      expect(r.json).toEqual({ ok: true })
      expect(r.setCookie).toMatch(SESSION_CLEARED)
      expect(b.session).toBeUndefined()

      const userRef = db().collection('users').doc(u.uid)
      expect((await userRef.get()).exists).toBe(false)
      expect((await userRef.collection('tasks').doc('t1').get()).exists).toBe(false)
      expect((await userRef.collection('habits').doc('h1').collection('log').doc('d1').get()).exists).toBe(false)
      expect((await db().collection('users_auth').doc(u.uid).get()).exists).toBe(false)
      expect((await db().collection('auth_emails').doc(emailKey(u.email)).get()).exists).toBe(false)
      expect((await db().collection('auth_accounts').where('uid', '==', u.uid).get()).size).toBe(0)
      expect((await db().collection('otp_codes').where('data.uid', '==', u.uid).get()).size).toBe(0)
      expect((await db().collection('sessions').where('uid', '==', u.uid).get()).size).toBe(0)
      expect((await db().collection('auth_throttle').doc(emailKey(u.email)).get()).exists).toBe(false)
      await expect(adminAuth().getUser(u.uid)).rejects.toMatchObject({ code: 'auth/user-not-found' })
      // Tombstone: the credential version stays, far in the future, so old bridge tokens are useless.
      const tomb = await db().collection('auth_state').doc(u.uid).get()
      expect(tomb.exists).toBe(true)
      expect(Number(tomb.get('cv'))).toBeGreaterThan(Date.now() + 365 * 1440 * MINUTE)
      expect(mail.kindsFor(u.email)).toContain('account-deleted')
      expect(await meStatus(other.session)).toBe(401)
      const gone = await login(u.email, PASSWORD)
      expect(gone.status).toBe(401)
      expect(errorCode(gone)).toBe('invalid_credentials')

      // The other user is untouched.
      expect((await db().collection('users').doc(v.uid).get()).exists).toBe(true)
      expect((await db().collection('users').doc(v.uid).collection('tasks').doc('t1').get()).exists).toBe(true)
      expect((await db().collection('users_auth').doc(v.uid).get()).exists).toBe(true)
      expect((await db().collection('auth_emails').doc(emailKey(v.email)).get()).get('uid')).toBe(v.uid)
      expect((await db().collection('auth_accounts').where('uid', '==', v.uid).get()).size).toBe(1)
      expect((await db().collection('otp_codes').where('data.uid', '==', v.uid).get()).size).toBe(1)
      expect((await adminAuth().getUser(v.uid)).uid).toBe(v.uid)
      expect(await meStatus(vSession.session)).toBe(200)

      // The address is free again: a brand-new account (new uid).
      const rb = new Browser()
      const reg = await call(rb, 'POST', 'register', { email: u.email, password: NEW_PASSWORD })
      expect(reg.status, reg.text).toBe(202)
      expect(mail.kindsFor(u.email)).toContain('verify-code')
      const verified = await call(rb, 'POST', 'verify-email', { email: u.email, code: mail.lastCode(u.email), password: NEW_PASSWORD })
      expect(verified.status, verified.text).toBe(200)
      const newUid = (verified.json.user as { uid: string }).uid
      expect(newUid).toBeTruthy()
      expect(newUid).not.toBe(u.uid)
    })
  })

  // ================================================================== 5. logs

  it('no secrets in logs across reset, change, email change and deletion (passwords, codes, cookies)', async () => {
    const lines: string[] = []
    const restore = captureLogs((l) => lines.push(l))
    const secrets: string[] = [PASSWORD, NEW_PASSWORD, WRONG_PASSWORD, BREACHED]
    const third = 'third passphrase for logs 9'
    secrets.push(third)
    try {
      const u = await seedUser()
      const rb = new Browser()
      await resetRequest(rb, u.email)
      secrets.push(rb.otp as string)
      const resetCode = lastCode('reset-code', u.email)
      secrets.push(resetCode)
      await resetConfirm(rb, u.email, otherCode8(resetCode))
      await resetConfirm(rb, u.email, resetCode, BREACHED)
      const confirmed = await resetConfirm(rb, u.email, resetCode)
      expect(confirmed.status).toBe(200)
      secrets.push(rb.session as string)

      await changePassword(rb, WRONG_PASSWORD, third)
      // A mail outage on a security notice is logged, but must not leak anything.
      setMailerForTests({ send: async () => { throw new Error('smtp down') } })
      const changed = await changePassword(rb, NEW_PASSWORD, third)
      expect(changed.status).toBe(200)
      setMailerForTests(mail)
      secrets.push(rb.session as string)

      const newEmail = freshEmail()
      await emailChangeRequest(rb, newEmail, WRONG_PASSWORD)
      advance(COOLDOWN)
      await emailChangeRequest(rb, newEmail, third)
      secrets.push(rb.otp as string)
      const changeCode = lastCode('email-change-code', newEmail)
      secrets.push(changeCode)
      await emailChangeConfirm(rb, newEmail, otherCode8(changeCode))
      expect((await emailChangeConfirm(rb, newEmail, changeCode)).status).toBe(200)
      secrets.push(rb.session as string)

      await deleteAccount(rb, WRONG_PASSWORD)
      expect((await deleteAccount(rb, third)).status).toBe(200)
    } finally {
      restore()
    }
    expect(lines.length).toBeGreaterThan(3)
    const all = lines.join('\n')
    for (const s of secrets) {
      expect(s.length).toBeGreaterThan(5)
      expect(all).not.toContain(s)
    }
    expect(all).not.toMatch(/\$argon2id\$/)
  })
})
