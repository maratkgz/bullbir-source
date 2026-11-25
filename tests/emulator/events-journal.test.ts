// Stage 8 — security event journal (`security_events` + GET security-events), driven through the
// real router against the Firestore + Auth emulators (project "demo-bullbir" only).
// NOTE: the Firestore emulator ignores composite-index requirements, so the query shape is also
// checked against firestore.indexes.json by reading the files.
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp as deleteAdminApp, getApps as getAdminApps } from 'firebase-admin/app'
import { Timestamp } from 'firebase-admin/firestore'
import { resetEnvForTests } from '../../server/env.js'
import { adminDb } from '../../server/firebaseAdmin.js'
import type { ApiRequest, ApiResponse } from '../../server/http.js'
import { captureLogs } from '../../server/log.js'
import { MemoryRateLimiter } from '../../server/rateLimit.js'
import { createHandler } from '../../server/router.js'
import { routes } from '../../server/routes/index.js'
import { emailKey, normalizeEmail } from '../../server/auth/email.js'
import { EVENT_RETENTION_MS, EVENTS_PAGE_SIZE, SECURITY_EVENTS, setEventSinkForTests } from '../../server/auth/events.js'
import { setMailerForTests, type AuthMail } from '../../server/auth/mailer.js'
import { setMinResponseMsForTests } from '../../server/auth/pacing.js'
import { hashPassword, setBreachCheckerForTests } from '../../server/auth/password.js'
import { setClockForTests } from '../../server/auth/time.js'
import {
  EMULATORS_RUNNING,
  errorCode,
  MailBox,
  nextIp,
  ORIGIN,
  resetEmulators,
  TEST_ENV,
  UA_CHROME_WIN,
  UA_FIREFOX_LINUX,
  type FakeResponse,
} from './helpers/authHarness.js'

const DAY = 86_400_000
const PASSWORD = 'correct horse battery staple'
const NEW_PASSWORD = 'a brand new passphrase 42'
const WRONG_PASSWORD = 'definitely not the password'
const BREACHED = 'password123456'
const DEVICE_LABELS = new Set(['Chrome · Windows', 'Firefox · Linux'])
const DOC_KEYS = ['at', 'device', 'expiresAt', 'ipPrefix', 'meta', 'type', 'uid']

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
  const headers: Record<string, string> = { 'x-vercel-forwarded-for': b.ip, 'user-agent': b.userAgent, origin: ORIGIN }
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

type EventRow = { id: string; data: Record<string, unknown> }

/** Timestamps → ISO strings, so a JSON scan sees only what is stored as text. */
function plain(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(plain)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
  return value
}

const suite = EMULATORS_RUNNING ? describe : describe.skip

suite('stage 8 — security event journal (emulator)', () => {
  let savedEnv: Record<string, string | undefined>
  let handler: ReturnType<typeof createHandler>
  let mail: MailBox
  let clockMs: number
  let seq = 0
  let logs: string[] = []
  let restoreLogs: () => void = () => undefined

  const db = () => adminDb()
  const freshEmail = (): string => normalizeEmail(`evt${Date.now()}x${++seq}@example.test`)
  const freshUid = (): string => `Evt${Date.now()}${++seq}`.padEnd(28, 'x').slice(0, 28)
  const advance = (ms: number): void => { clockMs += ms }
  const call = (b: Browser, method: string, path: string, body?: unknown): Promise<Res> => send(handler, b, method, path, body)
  const login = (email: string, password: string, b = new Browser()): Promise<Res> => call(b, 'POST', 'login', { email, password })
  const listEvents = (b: Browser): Promise<Res> => call(b, 'GET', 'security-events')

  async function allEvents(): Promise<EventRow[]> {
    return (await db().collection(SECURITY_EVENTS).get()).docs.map((d) => ({ id: d.id, data: d.data() }))
  }
  async function eventsOf(type: string, uid?: string): Promise<EventRow[]> {
    return (await allEvents()).filter((e) => e.data.type === type && (uid === undefined || e.data.uid === uid))
  }
  async function onlyEvent(type: string, uid?: string): Promise<Record<string, unknown>> {
    const list = await eventsOf(type, uid)
    expect(list, `${type} events`).toHaveLength(1)
    return list[0]!.data
  }

  function lastCode(kind: CodeKind, to: string): string {
    const list = mail.sent.flatMap((m: AuthMail) => (m.kind === kind && m.to === to ? [m.code] : []))
    const last = list[list.length - 1]
    if (!last) throw new Error(`no ${kind} mailed to ${to}`)
    return last
  }

  type Seeded = { uid: string; email: string }

  async function seedUser(opts: { email?: string; emailVerified?: boolean } = {}): Promise<Seeded> {
    const uid = freshUid()
    const email = opts.email ?? freshEmail()
    const ts = new Date(clockMs)
    await db().collection('auth_emails').doc(emailKey(email)).create({ uid, createdAt: ts })
    await db().collection('users_auth').doc(uid).create({
      email,
      emailVerified: opts.emailVerified ?? true,
      passwordHash: await hashPassword(PASSWORD),
      legacyPassword: null,
      displayName: 'Seeded User',
      providers: ['password'],
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
      lastLoginAt: null,
      passwordChangedAt: null,
    })
    return { uid, email }
  }

  async function signedIn(email: string, password = PASSWORD, b = new Browser()): Promise<Browser> {
    const r = await login(email, password, b)
    expect(r.status, r.text).toBe(200)
    expect(b.session).toBeTruthy()
    return b
  }

  /** register → verify-email in one browser; returns the new uid. */
  async function registerAndVerify(email: string, b = new Browser()): Promise<{ uid: string; b: Browser }> {
    const reg = await call(b, 'POST', 'register', { email, password: PASSWORD })
    expect(reg.status, reg.text).toBe(202)
    const v = await call(b, 'POST', 'verify-email', { email, code: mail.lastCode(email), password: PASSWORD })
    expect(v.status, v.text).toBe(200)
    return { uid: (v.json.user as { uid: string }).uid, b }
  }

  async function sessionIds(b: Browser): Promise<{ id: string; current: boolean }[]> {
    const r = await call(b, 'GET', 'sessions')
    expect(r.status, r.text).toBe(200)
    return r.json.sessions as { id: string; current: boolean }[]
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
    setEventSinkForTests(undefined)
    setMailerForTests(undefined)
    setBreachCheckerForTests(undefined)
    setClockForTests(undefined)
    setMinResponseMsForTests(undefined)
    await Promise.all(getAdminApps().map((a) => deleteAdminApp(a)))
    resetEnvForTests()
  })

  beforeEach(async () => {
    await resetEmulators()
    logs = []
    restoreLogs = captureLogs((l) => { logs.push(l) })
    mail = new MailBox()
    setMailerForTests(mail)
    setBreachCheckerForTests(async (p) => p === BREACHED)
    setMinResponseMsForTests(0)
    setEventSinkForTests(undefined)
    clockMs = Date.now()
    setClockForTests(() => clockMs)
    const limiter = new MemoryRateLimiter(() => clockMs)
    handler = createHandler(routes, { limiter: () => limiter })
  })

  afterEach(() => {
    setEventSinkForTests(undefined)
    setClockForTests(undefined)
    setBreachCheckerForTests(undefined)
    restoreLogs()
  })

  // ================================================================== 0. index

  it('listSecurityEvents queries exactly the shape of the declared composite index (uid ASC, at DESC)', () => {
    const indexes = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')) as {
      indexes: { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order: string }[] }[]
    }
    const idx = indexes.indexes.filter((i) => i.collectionGroup === SECURITY_EVENTS)
    expect(idx).toHaveLength(1)
    expect(idx[0]!.queryScope).toBe('COLLECTION')
    expect(idx[0]!.fields).toEqual([
      { fieldPath: 'uid', order: 'ASCENDING' },
      { fieldPath: 'at', order: 'DESCENDING' },
    ])
    // The emulator would accept any query, so pin the query in the source to that index.
    const src = readFileSync(new URL('../../server/auth/events.ts', import.meta.url), 'utf8')
    const fn = src.slice(src.indexOf('export async function listSecurityEvents'))
    const chain = /\.collection\(SECURITY_EVENTS\)\s*\.where\('uid', '==', uid\)\.orderBy\('at', 'desc'\)\.limit\(limit\)\.get\(\)/
    expect(fn).toMatch(chain)
    expect((fn.match(/\.where\(/g) ?? []).length).toBe(1)
    expect((fn.match(/\.orderBy\(/g) ?? []).length).toBe(1)
    expect(EVENTS_PAGE_SIZE).toBe(50)
    // firebase.json deploys the index file.
    const fbJson = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8')) as { firestore?: { indexes?: string } }
    expect(fbJson.firestore?.indexes).toBe('firestore.indexes.json')
  })

  // ================================================================== 1. which events

  describe('events written by each flow', () => {
    it('register → verify writes `register` (method password) for the new uid; no login_success', async () => {
      const email = freshEmail()
      const { uid } = await registerAndVerify(email)
      const e = await onlyEvent('register')
      expect(e.uid).toBe(uid)
      expect(e.meta).toEqual({ method: 'password' })
      expect(await eventsOf('login_success')).toHaveLength(0)
    })

    it('login success → login_success (method password) with uid', async () => {
      const u = await seedUser()
      await signedIn(u.email)
      const e = await onlyEvent('login_success')
      expect(e.uid).toBe(u.uid)
      expect(e.meta).toEqual({ method: 'password' })
    })

    it('wrong password → login_failure reason wrong_credentials WITH uid', async () => {
      const u = await seedUser()
      const r = await login(u.email, WRONG_PASSWORD)
      expect(r.status).toBe(401)
      const e = await onlyEvent('login_failure')
      expect(e.uid).toBe(u.uid)
      expect(e.meta).toEqual({ method: 'password', reason: 'wrong_credentials' })
    })

    it('unknown email → login_failure reason unknown_account WITHOUT uid', async () => {
      const r = await login(freshEmail(), PASSWORD)
      expect(r.status).toBe(401)
      const e = await onlyEvent('login_failure')
      expect('uid' in e).toBe(false)
      expect(e.meta).toEqual({ method: 'password', reason: 'unknown_account' })
    })

    it('5th failure → login_locked with retryAfterSec (= Retry-After); the 4 before are login_failure; a locked attempt adds nothing', async () => {
      const u = await seedUser()
      for (let i = 0; i < 4; i++) expect((await login(u.email, WRONG_PASSWORD)).status).toBe(401)
      const fifth = await login(u.email, WRONG_PASSWORD)
      expect(fifth.status).toBe(429)
      expect(await eventsOf('login_failure', u.uid)).toHaveLength(4)
      const e = await onlyEvent('login_locked', u.uid)
      const retry = Number(fifth.headers['retry-after'])
      expect(e.meta).toEqual({ retryAfterSec: retry })
      expect(retry).toBe(15 * 60)
      expect((await login(u.email, PASSWORD)).status).toBe(429)
      expect(await allEvents()).toHaveLength(5)
    })

    it('unknown email locked → login_locked without uid', async () => {
      const email = freshEmail()
      for (let i = 0; i < 5; i++) await login(email, WRONG_PASSWORD)
      const e = await onlyEvent('login_locked')
      expect('uid' in e).toBe(false)
      expect(typeof (e.meta as { retryAfterSec?: unknown }).retryAfterSec).toBe('number')
    })

    it('code login → login_success (method code)', async () => {
      const u = await seedUser()
      const b = new Browser()
      expect((await call(b, 'POST', 'otp/request', { email: u.email })).status).toBe(202)
      const v = await call(b, 'POST', 'otp/verify', { email: u.email, code: lastCode('login-code', u.email) })
      expect(v.status, v.text).toBe(200)
      const e = await onlyEvent('login_success', u.uid)
      expect(e.meta).toEqual({ method: 'code' })
    })

    it('logout → logout; logout without a session writes nothing', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      expect((await call(b, 'POST', 'logout')).status).toBe(200)
      const e = await onlyEvent('logout', u.uid)
      expect(e.meta).toEqual({})
      expect((await call(new Browser(), 'POST', 'logout')).status).toBe(200)
      expect(await eventsOf('logout')).toHaveLength(1)
    })

    it('logout-all → logout_all', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      await signedIn(u.email)
      expect((await call(b, 'POST', 'logout-all')).status).toBe(200)
      await onlyEvent('logout_all', u.uid)
    })

    it('DELETE sessions/:id → session_revoked wasCurrent false (other) then true (own)', async () => {
      const u = await seedUser()
      const other = await signedIn(u.email, PASSWORD, new Browser(nextIp(), UA_FIREFOX_LINUX))
      const b = await signedIn(u.email)
      const list = await sessionIds(b)
      const otherId = list.find((s) => !s.current)!.id
      const ownId = list.find((s) => s.current)!.id
      expect((await call(b, 'DELETE', `sessions/${otherId}`)).status).toBe(200)
      advance(1_000)
      const own = await call(b, 'DELETE', `sessions/${ownId}`)
      expect(own.status).toBe(200)
      const revoked = (await eventsOf('session_revoked', u.uid))
        .map((e) => e.data)
        .sort((a, z) => (a.at as Timestamp).toMillis() - (z.at as Timestamp).toMillis())
      expect(revoked.map((e) => e.meta)).toEqual([{ wasCurrent: false }, { wasCurrent: true }])
      expect(other.session).toBeTruthy()
      // An unknown id is a 404 and is not journaled.
      const c = await signedIn(u.email)
      expect((await call(c, 'DELETE', `sessions/${'0'.repeat(32)}`)).status).toBe(404)
      expect(await eventsOf('session_revoked', u.uid)).toHaveLength(2)
    })

    it('password reset → password_reset', async () => {
      const u = await seedUser()
      const b = new Browser()
      expect((await call(b, 'POST', 'password/reset-request', { email: u.email })).status).toBe(202)
      const r = await call(b, 'POST', 'password/reset-confirm', { email: u.email, code: lastCode('reset-code', u.email), newPassword: NEW_PASSWORD })
      expect(r.status, r.text).toBe(200)
      await onlyEvent('password_reset', u.uid)
    })

    it('password change → password_changed', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      const r = await call(b, 'POST', 'password/change', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      expect(r.status, r.text).toBe(200)
      await onlyEvent('password_changed', u.uid)
    })

    it('email change → email_changed (only on confirm)', async () => {
      const u = await seedUser()
      const b = await signedIn(u.email)
      const newEmail = freshEmail()
      expect((await call(b, 'POST', 'email/change-request', { newEmail, currentPassword: PASSWORD })).status).toBe(202)
      expect(await eventsOf('email_changed')).toHaveLength(0)
      const r = await call(b, 'POST', 'email/change-confirm', { newEmail, code: lastCode('email-change-code', newEmail) })
      expect(r.status, r.text).toBe(200)
      await onlyEvent('email_changed', u.uid)
    })

    it('breached password at register → breached_password_rejected WITHOUT uid', async () => {
      const r = await call(new Browser(), 'POST', 'register', { email: freshEmail(), password: BREACHED })
      expect(r.status).toBe(400)
      expect(errorCode(r)).toBe('breached_password')
      const e = await onlyEvent('breached_password_rejected')
      expect('uid' in e).toBe(false)
      expect(e.meta).toEqual({})
    })

    it('account delete → the user’s events are gone, exactly one account_deleted without uid, others’ events kept', async () => {
      const u = await seedUser()
      const v = await seedUser()
      await login(u.email, WRONG_PASSWORD)
      const b = await signedIn(u.email)
      await signedIn(v.email)
      expect((await allEvents()).filter((e) => e.data.uid === u.uid)).toHaveLength(2)
      const r = await call(b, 'POST', 'account/delete', { currentPassword: PASSWORD })
      expect(r.status, r.text).toBe(200)
      const after = await allEvents()
      expect(after.filter((e) => e.data.uid === u.uid)).toHaveLength(0)
      const deleted = after.filter((e) => e.data.type === 'account_deleted')
      expect(deleted).toHaveLength(1)
      expect('uid' in deleted[0]!.data).toBe(false)
      expect(deleted[0]!.data.meta).toEqual({})
      expect(after.filter((e) => e.data.uid === v.uid).map((e) => e.data.type)).toEqual(['login_success'])
    })
  })

  // ================================================================== 2. doc shape + no secrets

  it('every doc: at, expiresAt = at + 180 days, short device label, /24 ip prefix; no email/password/code/token/cookie/UA/IP anywhere', async () => {
    const secrets: string[] = [PASSWORD, NEW_PASSWORD, WRONG_PASSWORD, BREACHED, UA_CHROME_WIN, UA_FIREFOX_LINUX]
    const ips: string[] = []
    const browser = (ua = UA_CHROME_WIN): Browser => { const b = new Browser(nextIp(), ua); ips.push(b.ip); return b }
    const emails: string[] = []

    // register → verify
    const regEmail = freshEmail()
    emails.push(regEmail)
    const reg = await registerAndVerify(regEmail, browser())
    secrets.push(mail.lastCode(regEmail), reg.b.session as string)
    // breached at register
    await call(browser(), 'POST', 'register', { email: freshEmail(), password: BREACHED })
    // logins: success, wrong, unknown, lock
    const u = await seedUser()
    emails.push(u.email)
    const ub = await signedIn(u.email, PASSWORD, browser(UA_FIREFOX_LINUX))
    secrets.push(ub.session as string)
    const ghost = freshEmail()
    emails.push(ghost)
    await login(ghost, PASSWORD, browser())
    for (let i = 0; i < 5; i++) await login(u.email, WRONG_PASSWORD, browser())
    // code login (lifts the lock)
    const cb = browser()
    await call(cb, 'POST', 'otp/request', { email: u.email })
    secrets.push(cb.otp as string)
    const loginCode = lastCode('login-code', u.email)
    secrets.push(loginCode)
    expect((await call(cb, 'POST', 'otp/verify', { email: u.email, code: loginCode })).status).toBe(200)
    secrets.push(cb.session as string)
    // session revoke, logout
    const other = (await sessionIds(cb)).find((s) => !s.current)!
    await call(cb, 'DELETE', `sessions/${other.id}`)
    // reset, change, email change
    const rb = browser()
    await call(rb, 'POST', 'password/reset-request', { email: u.email })
    secrets.push(rb.otp as string)
    const resetCode = lastCode('reset-code', u.email)
    secrets.push(resetCode)
    expect((await call(rb, 'POST', 'password/reset-confirm', { email: u.email, code: resetCode, newPassword: NEW_PASSWORD })).status).toBe(200)
    secrets.push(rb.session as string)
    expect((await call(rb, 'POST', 'password/change', { currentPassword: NEW_PASSWORD, newPassword: PASSWORD })).status).toBe(200)
    secrets.push(rb.session as string)
    const newEmail = freshEmail()
    emails.push(newEmail)
    await call(rb, 'POST', 'email/change-request', { newEmail, currentPassword: PASSWORD })
    secrets.push(rb.otp as string)
    const changeCode = lastCode('email-change-code', newEmail)
    secrets.push(changeCode)
    expect((await call(rb, 'POST', 'email/change-confirm', { newEmail, code: changeCode })).status).toBe(200)
    secrets.push(rb.session as string)
    expect((await call(reg.b, 'POST', 'logout')).status).toBe(200)
    expect((await call(rb, 'POST', 'logout-all')).status).toBe(200)
    // a second user deletes their account
    const d = await seedUser()
    emails.push(d.email)
    const db2 = await signedIn(d.email, PASSWORD, browser())
    expect((await call(db2, 'POST', 'account/delete', { currentPassword: PASSWORD })).status).toBe(200)

    const events = await allEvents()
    const types = new Set(events.map((e) => e.data.type))
    for (const t of ['register', 'breached_password_rejected', 'login_success', 'login_failure', 'login_locked', 'session_revoked',
      'password_reset', 'password_changed', 'email_changed', 'logout', 'logout_all', 'account_deleted']) {
      expect(types, t).toContain(t)
    }

    for (const { data } of events) {
      for (const k of Object.keys(data)) expect(DOC_KEYS, `unexpected field ${k}`).toContain(k)
      expect(data.at).toBeInstanceOf(Timestamp)
      expect(data.expiresAt).toBeInstanceOf(Timestamp)
      const at = (data.at as Timestamp).toMillis()
      expect(Math.abs(at - clockMs)).toBeLessThan(DAY) // the injected clock, not wall time drift
      expect((data.expiresAt as Timestamp).toMillis() - at).toBe(EVENT_RETENTION_MS)
      expect(EVENT_RETENTION_MS).toBe(180 * DAY)
      expect(typeof data.device).toBe('string')
      expect(DEVICE_LABELS).toContain(data.device)
      expect(String(data.device)).not.toMatch(/Mozilla|AppleWebKit|Gecko|\d+\.\d+/)
      expect(String(data.ipPrefix)).toMatch(/^10\.\d{1,3}\.\d{1,3}\.0$/)
      expect(ips).not.toContain(data.ipPrefix)
      expect(typeof data.meta).toBe('object')
    }
    expect(events.some((e) => e.data.device === 'Firefox · Linux')).toBe(true)

    const json = JSON.stringify(events.map((e) => plain(e.data)))
    for (const s of secrets) {
      expect(s.length).toBeGreaterThan(5)
      expect(json).not.toContain(s)
    }
    for (const e of emails) {
      expect(json).not.toContain(e)
      expect(json).not.toContain(e.split('@')[0]!)
    }
    for (const ip of ips) expect(json).not.toContain(`"${ip}"`)
    expect(json).not.toMatch(/@|argon|__Host-/i)
  })

  // ================================================================== 3. GET security-events

  describe('GET security-events', () => {
    it('401 without a session (and with a dead one)', async () => {
      const r = await listEvents(new Browser())
      expect(r.status).toBe(401)
      expect(errorCode(r)).toBe('unauthorized')
      const u = await seedUser()
      const b = await signedIn(u.email)
      expect((await listEvents(b)).status).toBe(200)
      await call(b, 'POST', 'logout')
      const dead = new Browser()
      dead.session = 'A'.repeat(43)
      expect((await listEvents(dead)).status).toBe(401)
      const stale = new Browser()
      stale.session = (await signedIn(u.email)).session
      await call(stale, 'POST', 'logout')
      stale.session = b.session
      expect((await listEvents(stale)).status).toBe(401)
    })

    it('newest first, only {type, at, device, ipPrefix}, only the caller’s events', async () => {
      const email = freshEmail()
      const reg = await registerAndVerify(email)
      advance(1_000)
      expect((await login(email, WRONG_PASSWORD)).status).toBe(401)
      advance(1_000)
      const other = await seedUser()
      await login(other.email, WRONG_PASSWORD) // someone else's events in between
      advance(500)
      await signedIn(other.email)
      advance(1_000)
      const b = await signedIn(email, PASSWORD, new Browser(nextIp(), UA_FIREFOX_LINUX))

      const r = await listEvents(b)
      expect(r.status, r.text).toBe(200)
      expect(Object.keys(r.json)).toEqual(['events'])
      const events = r.json.events as Record<string, unknown>[]
      expect(events.map((e) => e.type)).toEqual(['login_success', 'login_failure', 'register'])
      for (const e of events) {
        expect(Object.keys(e).sort()).toEqual(['at', 'device', 'ipPrefix', 'type'])
        expect(e.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
        expect(DEVICE_LABELS).toContain(e.device)
        expect(e.ipPrefix).toMatch(/^10\.\d{1,3}\.\d{1,3}\.0$/)
      }
      expect(events[0]!.device).toBe('Firefox · Linux')
      expect(events[2]!.device).toBe('Chrome · Windows')
      const ats = events.map((e) => Date.parse(e.at as string))
      expect([...ats].sort((x, y) => y - x)).toEqual(ats)
      expect(r.text).not.toMatch(/uid|meta|method|reason|expiresAt/)
      expect(r.text).not.toContain(reg.uid)
      expect(r.text).not.toContain(email)

      // The other user sees only their own two.
      const ob = await signedIn(other.email)
      const theirs = (await listEvents(ob)).json.events as { type: string }[]
      expect(theirs.map((e) => e.type)).toEqual(['login_success', 'login_success', 'login_failure'])
    })

    it('at most 50, the newest ones; another user’s events never appear', async () => {
      const u = await seedUser()
      const v = await seedUser()
      const base = clockMs - 10 * DAY
      const batch = db().batch()
      for (let i = 0; i < 70; i++) {
        const at = new Date(base + i * 60_000)
        batch.create(db().collection(SECURITY_EVENTS).doc(), {
          uid: u.uid, type: i % 2 ? 'login_failure' : 'logout', ipPrefix: '10.9.9.0', device: 'Chrome · Windows',
          at, expiresAt: new Date(at.getTime() + EVENT_RETENTION_MS), meta: { method: 'password', reason: 'wrong_credentials' },
        })
        // v's events interleave and are newer than many of u's.
        const vAt = new Date(base + i * 60_000 + 30_000)
        batch.create(db().collection(SECURITY_EVENTS).doc(), {
          uid: v.uid, type: 'password_changed', ipPrefix: '10.8.8.0', device: 'Firefox · Linux',
          at: vAt, expiresAt: new Date(vAt.getTime() + EVENT_RETENTION_MS), meta: {},
        })
      }
      // An event without uid must never be listed for anyone either.
      batch.create(db().collection(SECURITY_EVENTS).doc(), {
        type: 'account_deleted', ipPrefix: '10.7.7.0', device: 'Chrome · Windows', at: new Date(clockMs), expiresAt: new Date(clockMs + EVENT_RETENTION_MS), meta: {},
      })
      await batch.commit()

      const b = await signedIn(u.email) // + 1 real login_success, the newest
      const r = await listEvents(b)
      expect(r.status, r.text).toBe(200)
      const events = r.json.events as { type: string; at: string; device: string; ipPrefix: string }[]
      expect(events).toHaveLength(50)
      expect(events[0]!.type).toBe('login_success')
      expect(events[0]!.ipPrefix).not.toBe('10.9.9.0')
      const seeded = events.slice(1)
      // The 49 newest seeded ones: i = 69 … 21.
      expect(seeded.map((e) => Date.parse(e.at))).toEqual(Array.from({ length: 49 }, (_, k) => base + (69 - k) * 60_000))
      for (const e of events) {
        expect(e.type).not.toBe('password_changed')
        expect(e.type).not.toBe('account_deleted')
        expect(e.ipPrefix).not.toBe('10.8.8.0')
        expect(e.ipPrefix).not.toBe('10.7.7.0')
      }
      expect(r.text).not.toMatch(/reason|wrong_credentials|method/)
    })
  })

  // ================================================================== 4. failing sink

  describe('a failing event sink never breaks auth', () => {
    for (const [label, sink] of [
      ['throws synchronously', () => { throw new Error('journal down') }],
      ['rejects', async () => { throw new Error('journal down') }],
    ] as const) {
      it(`sink ${label}: register/verify, login, wrong password, logout, logout-all, revoke still answer normally`, async () => {
        setEventSinkForTests(sink)
        const email = freshEmail()
        const { b } = await registerAndVerify(email)
        expect(b.session).toBeTruthy()

        const wrong = await login(email, WRONG_PASSWORD)
        expect(wrong.status).toBe(401)
        expect(errorCode(wrong)).toBe('invalid_credentials')
        const breached = await call(new Browser(), 'POST', 'register', { email: freshEmail(), password: BREACHED })
        expect(errorCode(breached)).toBe('breached_password')

        const s = await signedIn(email)
        const lo = await call(s, 'POST', 'logout')
        expect(lo.status).toBe(200)
        expect(lo.json).toEqual({ ok: true })

        const s2 = await signedIn(email)
        const other = (await sessionIds(s2)).find((x) => !x.current)!
        expect((await call(s2, 'DELETE', `sessions/${other.id}`)).status).toBe(200)
        const all = await call(s2, 'POST', 'logout-all')
        expect(all.status).toBe(200)
        expect(all.json).toEqual({ ok: true })

        expect(await allEvents()).toHaveLength(0)
        const failures = logs.filter((l) => l.includes('security event write failed'))
        expect(failures.length).toBeGreaterThanOrEqual(7)
        const joined = logs.join('\n')
        expect(joined).not.toContain(PASSWORD)
        expect(joined).not.toContain(email)
      })
    }
  })
})
