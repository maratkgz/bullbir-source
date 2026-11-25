// Stage 8 — security events written by Google sign-in (fake Google, as in oauth-google.test.ts),
// against the Firestore + Auth emulators (project "demo-bullbir" only).
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
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
import { createOAuthRoutes } from '../../server/routes/oauth.js'
import { emailKey, normalizeEmail } from '../../server/auth/email.js'
import { EVENT_RETENTION_MS, SECURITY_EVENTS, setEventSinkForTests } from '../../server/auth/events.js'
import { GOOGLE_AUTH_URL, GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL } from '../../server/auth/oauth/google.js'
import { JwksCache } from '../../server/auth/oauth/jwt.js'
import type { FetchLike } from '../../server/auth/oauth/provider.js'
import { setMailerForTests } from '../../server/auth/mailer.js'
import { setMinResponseMsForTests } from '../../server/auth/pacing.js'
import { hashPassword, setBreachCheckerForTests } from '../../server/auth/password.js'
import { EMULATORS_RUNNING, MailBox, nextIp, ORIGIN, resetEmulators, TEST_ENV, UA_CHROME_WIN } from './helpers/authHarness.js'

const CLIENT_ID = 'test-client'
const CLIENT_SECRET = 'test-secret-value-never-logged'
const KID = 'fake-google-key'
const PASSWORD = 'correct horse battery staple'

type Person = { sub: string; email: string }
type Grant = { nonce: string; challenge: string; redirectUri: string; claims: Record<string, unknown>; used: boolean }

let signingKey: KeyObject
let publicJwk: Record<string, unknown>

class FakeGoogle {
  readonly grants = new Map<string, Grant>()
  readonly issued: string[] = []

  authorize(location: string, person: Person): string {
    const url = new URL(location)
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_URL)
    const q = url.searchParams
    const code = `4/0A${randomBytes(24).toString('base64url')}`
    this.grants.set(code, {
      nonce: q.get('nonce') ?? '',
      challenge: q.get('code_challenge') ?? '',
      redirectUri: q.get('redirect_uri') ?? '',
      claims: { sub: person.sub, email: person.email, email_verified: true },
      used: false,
    })
    return code
  }

  readonly fetch: FetchLike = async (url, init) => {
    if (url === GOOGLE_JWKS_URL) return new Response(JSON.stringify({ keys: [publicJwk] }))
    if (url !== GOOGLE_TOKEN_URL) throw new Error(`fake Google: unexpected fetch ${url}`)
    const body = new URLSearchParams(String(init?.body))
    const grant = this.grants.get(body.get('code') ?? '')
    const bad = () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    if (!grant || grant.used) return bad()
    grant.used = true
    if (body.get('redirect_uri') !== grant.redirectUri) return bad()
    if (createHash('sha256').update(body.get('code_verifier') ?? '', 'ascii').digest('base64url') !== grant.challenge) return bad()
    const t = Math.floor(Date.now() / 1000)
    const payload = { iss: 'https://accounts.google.com', aud: CLIENT_ID, azp: CLIENT_ID, nonce: grant.nonce, iat: t - 2, exp: t + 3600, ...grant.claims }
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const input = `${b64({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${b64(payload)}`
    const idToken = `${input}.${sign('RSA-SHA256', Buffer.from(input), signingKey).toString('base64url')}`
    this.issued.push(idToken)
    return new Response(JSON.stringify({ id_token: idToken, access_token: 'ya29.fake-access-token', token_type: 'Bearer' }))
  }
}

class Browser {
  session: string | undefined
  oauth: string | undefined
  readonly ip = nextIp()
  absorb(cookies: string[]): void {
    for (const c of cookies) {
      const m = /^(__Host-session|__Host-oauth)=([^;]*)/.exec(c)
      if (!m) continue
      const value = /Max-Age=0\b/.test(c) || m[2] === '' ? undefined : m[2]
      if (m[1] === '__Host-session') this.session = value
      else this.oauth = value
    }
  }
}

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>
type Res = { status: number; json: Record<string, unknown>; location: string | undefined }

async function send(handler: Handler, b: Browser, method: string, path: string): Promise<Res> {
  const headers: Record<string, string> = { 'x-vercel-forwarded-for': b.ip, 'user-agent': UA_CHROME_WIN }
  if (method !== 'GET') headers.origin = ORIGIN
  const cookie = [b.session ? `__Host-session=${b.session}` : '', b.oauth ? `__Host-oauth=${b.oauth}` : ''].filter(Boolean).join('; ')
  if (cookie) headers.cookie = cookie
  const req = { method, url: `/api/auth/${path}`, headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as ApiRequest
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
  b.absorb(raw === undefined ? [] : [raw].flat())
  const loc = state.headers.location
  return {
    status: state.status,
    json: state.body ? (JSON.parse(state.body) as Record<string, unknown>) : {},
    location: Array.isArray(loc) ? loc[0] : loc,
  }
}

const suite = EMULATORS_RUNNING ? describe : describe.skip

suite('stage 8 — security events for Google sign-in (emulator, fake Google)', () => {
  let savedEnv: Record<string, string | undefined>
  let google: FakeGoogle
  let handler: Handler
  let mail: MailBox
  let seq = 0
  let restoreLogs: () => void = () => undefined

  const gmail = (): string => `ev${Date.now()}x${++seq}@gmail.com`
  const freshSub = (): string => `2${Date.now()}${++seq}`.padEnd(21, '3')
  const events = async () => (await adminDb().collection(SECURITY_EVENTS).get()).docs.map((d) => d.data())

  async function googleLogin(person: Person, b = new Browser()): Promise<{ b: Browser; r: Res }> {
    const s = await send(handler, b, 'GET', 'oauth/google/start')
    expect(s.status).toBe(302)
    const state = new URL(s.location ?? '').searchParams.get('state') ?? ''
    const code = google.authorize(s.location ?? '', person)
    const r = await send(handler, b, 'GET', `oauth/google/callback?${new URLSearchParams({ state, code }).toString()}`)
    return { b, r }
  }

  async function seedUser(email: string): Promise<string> {
    const uid = `O${Date.now()}${++seq}`.padEnd(28, 'x').slice(0, 28)
    const ts = new Date()
    await adminDb().collection('auth_emails').doc(emailKey(email)).create({ uid, createdAt: ts })
    await adminDb().collection('users_auth').doc(uid).create({
      email, emailVerified: true, passwordHash: await hashPassword(PASSWORD), legacyPassword: null, displayName: 'Seeded',
      providers: ['password'], status: 'active', createdAt: ts, updatedAt: ts, lastLoginAt: null, passwordChangedAt: null,
    })
    return uid
  }

  function expectShape(e: Record<string, unknown>): void {
    expect(e.at).toBeInstanceOf(Timestamp)
    expect((e.expiresAt as Timestamp).toMillis() - (e.at as Timestamp).toMillis()).toBe(EVENT_RETENTION_MS)
    expect(e.device).toBe('Chrome · Windows')
    expect(String(e.ipPrefix)).toMatch(/^10\.\d{1,3}\.\d{1,3}\.0$/)
  }

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    signingKey = pair.privateKey
    publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }
    const keys = [...Object.keys(TEST_ENV), 'VERCEL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_REDIRECT_BASE']
    savedEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
    Object.assign(process.env, TEST_ENV)
    process.env.VERCEL = '1'
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.OAUTH_REDIRECT_BASE
    resetEnvForTests()
  })

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    setEventSinkForTests(undefined)
    setBreachCheckerForTests(undefined)
    setMailerForTests(undefined)
    setMinResponseMsForTests(undefined)
    await Promise.all(getAdminApps().map((a) => deleteAdminApp(a)))
    resetEnvForTests()
  })

  beforeEach(async () => {
    await resetEmulators()
    restoreLogs = captureLogs(() => undefined)
    setBreachCheckerForTests(async () => false)
    setMinResponseMsForTests(0)
    setEventSinkForTests(undefined)
    mail = new MailBox()
    setMailerForTests(mail)
    google = new FakeGoogle()
    const limiter = new MemoryRateLimiter()
    const oauth = createOAuthRoutes({
      source: { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET },
      providers: { google: { fetch: google.fetch, jwks: new JwksCache(GOOGLE_JWKS_URL, google.fetch) } },
    })
    handler = createHandler([...routes.filter((r) => !r.path.startsWith('oauth/')), oauth.start, oauth.callback], { limiter: () => limiter })
  })

  afterEach(() => {
    setEventSinkForTests(undefined)
    restoreLogs()
  })

  it('new account via Google → register (oauth, google) + login_success (oauth, google); no oauth_linked; no secrets', async () => {
    const email = normalizeEmail(`ev${Date.now()}x${++seq}@example.test`)
    const sub = freshSub()
    const { b, r } = await googleLogin({ sub, email })
    expect(r.status).toBe(302)
    expect(r.location).toBe('/app')
    expect(b.session).toBeTruthy()
    const uid = (await adminDb().collection('auth_accounts').doc(`google.com:${sub}`).get()).get('uid') as string
    expect(uid).toBeTruthy()

    const all = await events()
    expect(all.map((e) => e.type).sort()).toEqual(['login_success', 'register'])
    for (const e of all) {
      expect(e.uid).toBe(uid)
      expect(e.meta).toEqual({ method: 'oauth', provider: 'google' })
      expectShape(e)
    }
    const json = JSON.stringify(all)
    for (const s of [email, sub, b.session as string, CLIENT_SECRET, 'ya29.fake-access-token', ...google.issued]) expect(json).not.toContain(s)

    // A second Google sign-in: login_success only.
    await googleLogin({ sub, email })
    const again = await events()
    expect(again.filter((e) => e.type === 'register')).toHaveLength(1)
    expect(again.filter((e) => e.type === 'login_success')).toHaveLength(2)

    // And the user sees them via GET security-events.
    const list = await send(handler, b, 'GET', 'security-events')
    expect(list.status).toBe(200)
    expect((list.json.events as { type: string }[]).map((e) => e.type)).toContain('register')
  })

  it('linking an existing verified gmail account → oauth_linked (google) + login_success; no register', async () => {
    const email = gmail()
    const uid = await seedUser(email)
    const { b, r } = await googleLogin({ sub: freshSub(), email })
    expect(r.location).toBe('/app')
    expect(b.session).toBeTruthy()
    const all = await events()
    expect(all.map((e) => e.type).sort()).toEqual(['login_success', 'oauth_linked'])
    const linked = all.find((e) => e.type === 'oauth_linked')!
    expect(linked.uid).toBe(uid)
    expect(linked.meta).toEqual({ provider: 'google' })
    expectShape(linked)
    const ok = all.find((e) => e.type === 'login_success')!
    expect(ok.uid).toBe(uid)
    expect(ok.meta).toEqual({ method: 'oauth', provider: 'google' })
    expect(JSON.stringify(all)).not.toContain(email)
  })

  it('a failing event sink does not break Google sign-in', async () => {
    setEventSinkForTests(async () => { throw new Error('journal down') })
    const { b, r } = await googleLogin({ sub: freshSub(), email: gmail() })
    expect(r.location).toBe('/app')
    expect(b.session).toBeTruthy()
    expect(await events()).toHaveLength(0)
  })
})
