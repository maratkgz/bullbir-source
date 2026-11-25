// Stage 5 — sign in with Google (OAuth 2.0 authorization code + PKCE S256 + state + nonce), driven
// through the real router against the Firestore + Auth emulators (project "demo-bullbir" only).
// Google itself is faked: a local RSA key signs the ID tokens and its JWK is served by a fake JWKS
// endpoint; the fake token endpoint enforces single-use codes, client credentials, redirect_uri and
// the PKCE verifier, and echoes the nonce from the authorization request. The real Google is never
// called (any other URL makes the fake throw).
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp as deleteAdminApp, getApps as getAdminApps } from 'firebase-admin/app'
import { resetEnvForTests } from '../../server/env.js'
import { adminAuth, adminDb } from '../../server/firebaseAdmin.js'
import type { ApiRequest, ApiResponse } from '../../server/http.js'
import { captureLogs } from '../../server/log.js'
import { MemoryRateLimiter } from '../../server/rateLimit.js'
import { createHandler } from '../../server/router.js'
import { routes } from '../../server/routes/index.js'
import { createOAuthRoutes } from '../../server/routes/oauth.js'
import { emailKey, normalizeEmail } from '../../server/auth/email.js'
import { GOOGLE_AUTH_URL, GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL } from '../../server/auth/oauth/google.js'
import { JwksCache } from '../../server/auth/oauth/jwt.js'
import type { FetchLike } from '../../server/auth/oauth/provider.js'
import { setMailerForTests } from '../../server/auth/mailer.js'
import { setMinResponseMsForTests } from '../../server/auth/pacing.js'
import { hashPassword, setBreachCheckerForTests } from '../../server/auth/password.js'
import { setClockForTests } from '../../server/auth/time.js'
import { EMULATORS_RUNNING, jwtPayload, MailBox, nextIp, ORIGIN, resetEmulators, TEST_ENV, UA_CHROME_WIN } from './helpers/authHarness.js'

const CLIENT_ID = 'test-client'
const CLIENT_SECRET = 'test-secret-value-never-logged'
const SOURCE = { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET }
const REDIRECT_URI = `${ORIGIN}/api/auth/oauth/google/callback`
const PASSWORD = 'correct horse battery staple'
const KID = 'fake-google-key'
const FLOW_COOKIE = /^__Host-oauth=[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/
const FLOW_CLEARED = /^__Host-oauth=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/

// ------------------------------------------------------------------ fake Google

let signingKey: KeyObject
let foreignKey: KeyObject
let publicJwk: Record<string, unknown>

type Grant = {
  nonce: string
  challenge: string
  redirectUri: string
  clientId: string
  claims: Record<string, unknown>
  used: boolean
}

type Person = { sub: string; email: string; emailVerified?: unknown; name?: string }

class FakeGoogle {
  readonly grants = new Map<string, Grant>()
  readonly calls: string[] = []
  readonly issuedTokens: string[] = []
  /** Applied to the next ID token(s): override/extend the claims (e.g. a wrong nonce). */
  tamper: Record<string, unknown> = {}
  key: KeyObject = signingKey

  /** The user consents on Google: returns the code Google would put on the callback URL. */
  authorize(location: string, person: Person): string {
    const url = new URL(location)
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_URL)
    const q = url.searchParams
    const code = `4/0A${randomBytes(36).toString('base64url')}`
    this.grants.set(code, {
      nonce: q.get('nonce') ?? '',
      challenge: q.get('code_challenge') ?? '',
      redirectUri: q.get('redirect_uri') ?? '',
      clientId: q.get('client_id') ?? '',
      claims: {
        sub: person.sub,
        email: person.email,
        email_verified: person.emailVerified ?? true,
        ...(person.name ? { name: person.name } : {}),
      },
      used: false,
    })
    return code
  }

  private idToken(grant: Grant): string {
    const t = Math.floor(Date.now() / 1000)
    const payload = {
      iss: 'https://accounts.google.com',
      aud: grant.clientId,
      azp: grant.clientId,
      nonce: grant.nonce,
      iat: t - 2,
      exp: t + 3600,
      ...grant.claims,
      ...this.tamper,
    }
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const input = `${b64({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${b64(payload)}`
    const token = `${input}.${sign('RSA-SHA256', Buffer.from(input), this.key).toString('base64url')}`
    this.issuedTokens.push(token)
    return token
  }

  readonly fetch: FetchLike = async (url, init) => {
    this.calls.push(url)
    if (url === GOOGLE_JWKS_URL) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'cache-control': 'public, max-age=600' } })
    }
    if (url === GOOGLE_TOKEN_URL) {
      expect(init?.method).toBe('POST')
      const body = new URLSearchParams(String(init?.body))
      const bad = (error: string) => new Response(JSON.stringify({ error }), { status: 400 })
      const grant = this.grants.get(body.get('code') ?? '')
      if (!grant || grant.used) return bad('invalid_grant')
      grant.used = true // a code is single-use, like at Google
      if (body.get('grant_type') !== 'authorization_code') return bad('unsupported_grant_type')
      if (body.get('client_id') !== CLIENT_ID || body.get('client_secret') !== CLIENT_SECRET) return bad('invalid_client')
      if (body.get('client_id') !== grant.clientId) return bad('invalid_client')
      if (body.get('redirect_uri') !== grant.redirectUri) return bad('redirect_uri_mismatch')
      const verifier = body.get('code_verifier') ?? ''
      if (createHash('sha256').update(verifier, 'ascii').digest('base64url') !== grant.challenge) return bad('invalid_grant')
      return new Response(JSON.stringify({ id_token: this.idToken(grant), access_token: 'ya29.fake-access-token', token_type: 'Bearer' }))
    }
    throw new Error(`fake Google: unexpected fetch ${url}`)
  }
}

// ------------------------------------------------------------------ browser

type Res = {
  status: number
  headers: Record<string, string | string[]>
  text: string
  json: Record<string, unknown>
  cookies: string[]
  location: string | undefined
}

/** A browser: own cookie jar (session + oauth flow cookie), own IP. */
class Browser {
  session: string | undefined
  oauth: string | undefined
  constructor(readonly ip: string = nextIp()) {}

  cookieHeader(): string | undefined {
    const parts = [
      this.session ? `__Host-session=${this.session}` : '',
      this.oauth ? `__Host-oauth=${this.oauth}` : '',
    ].filter(Boolean)
    return parts.length ? parts.join('; ') : undefined
  }

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

/** GET navigations carry no Origin header (as browsers do); POST/fetch calls carry ours. */
async function send(handler: Handler, b: Browser, method: string, path: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { 'x-vercel-forwarded-for': b.ip, 'user-agent': UA_CHROME_WIN }
  if (method !== 'GET') headers.origin = ORIGIN
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
  const loc = state.headers.location
  return {
    status: state.status,
    headers: state.headers,
    text: state.body,
    json: state.body ? (JSON.parse(state.body) as Record<string, unknown>) : {},
    cookies,
    location: Array.isArray(loc) ? loc[0] : loc,
  }
}

// ------------------------------------------------------------------ suite

const suite = EMULATORS_RUNNING ? describe : describe.skip

suite('sign in with Google (emulator, fake Google)', () => {
  let savedEnv: Record<string, string | undefined>
  let google: FakeGoogle
  let handler: Handler
  let unconfiguredHandler: Handler
  let logs: string[]
  let restoreLogs: () => void = () => undefined
  let seq = 0
  let mail: MailBox

  const freshEmail = (): string => `g${Date.now()}x${++seq}@example.test`
  const gmail = (): string => `g${Date.now()}x${++seq}@gmail.com`
  const freshSub = (): string => `1${Date.now()}${++seq}`.padEnd(21, '7')
  const userDoc = async (uid: string) => (await adminDb().collection('users_auth').doc(uid).get()).data() ?? {}
  const accounts = async () => (await adminDb().collection('auth_accounts').get()).docs
  const users = async () => (await adminDb().collection('users_auth').get()).docs
  const sessions = async () => (await adminDb().collection('sessions').get()).docs

  const call = (b: Browser, method: string, path: string, body?: unknown, h: Handler = handler) => send(h, b, method, path, body)
  const start = (b: Browser, h: Handler = handler) => call(b, 'GET', 'oauth/google/start', undefined, h)
  const callback = (b: Browser, query: Record<string, string>) =>
    call(b, 'GET', `oauth/google/callback?${new URLSearchParams(query).toString()}`)
  const me = (b: Browser) => call(b, 'GET', 'me')

  /** start → (consent at fake Google) → callback, in one browser. */
  async function googleLogin(person: Person, b = new Browser()): Promise<{ b: Browser; r: Res; code: string; state: string }> {
    const s = await start(b)
    expect(s.status).toBe(302)
    const state = new URL(s.location ?? '').searchParams.get('state') ?? ''
    const code = google.authorize(s.location ?? '', person)
    const r = await callback(b, { state, code, scope: 'openid email profile', authuser: '0', prompt: 'consent' })
    return { b, r, code, state }
  }

  function expectLoginError(r: Res, code: string): void {
    expect(r.status).toBe(302)
    expect(r.location).toBe(`/login?error=${code}`)
    expect(r.text).toBe('')
    expect(r.cookies.some((c) => c.startsWith('__Host-session='))).toBe(false)
    expect(r.cookies.some((c) => FLOW_CLEARED.test(c))).toBe(true)
  }

  async function seedUser(opts: { emailVerified?: boolean; status?: string; email?: string } = {}): Promise<{ uid: string; email: string }> {
    const uid = `G${Date.now()}${++seq}`.padEnd(28, 'x').slice(0, 28)
    const email = normalizeEmail(opts.email ?? freshEmail())
    const ts = new Date()
    const db = adminDb()
    await db.collection('auth_emails').doc(emailKey(email)).create({ uid, createdAt: ts })
    await db.collection('users_auth').doc(uid).create({
      email,
      emailVerified: opts.emailVerified ?? true,
      passwordHash: await hashPassword(PASSWORD),
      legacyPassword: null,
      displayName: 'Seeded User',
      providers: ['password'],
      status: opts.status ?? 'active',
      createdAt: ts,
      updatedAt: ts,
      lastLoginAt: null,
      passwordChangedAt: null,
    })
    return { uid, email }
  }

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    signingKey = pair.privateKey
    publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }
    foreignKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey

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
    setBreachCheckerForTests(undefined)
    setMailerForTests(undefined)
    setClockForTests(undefined)
    setMinResponseMsForTests(undefined)
    await Promise.all(getAdminApps().map((a) => deleteAdminApp(a)))
    resetEnvForTests()
  })

  beforeEach(async () => {
    await resetEmulators()
    logs = []
    restoreLogs = captureLogs((line) => { logs.push(line) })
    setBreachCheckerForTests(async () => false)
    setMinResponseMsForTests(0)
    mail = new MailBox()
    setMailerForTests(mail)
    google = new FakeGoogle()
    const limiter = new MemoryRateLimiter()
    const nonOAuth = routes.filter((r) => !r.path.startsWith('oauth/'))
    const oauth = createOAuthRoutes({
      source: SOURCE,
      providers: { google: { fetch: google.fetch, jwks: new JwksCache(GOOGLE_JWKS_URL, google.fetch) } },
    })
    handler = createHandler([...nonOAuth, oauth.start, oauth.callback], { limiter: () => limiter })
    const bare = createOAuthRoutes({ source: {} })
    unconfiguredHandler = createHandler([...nonOAuth, bare.start, bare.callback], { limiter: () => limiter })
  })

  afterEach(() => {
    restoreLogs()
    // Never the real Google: every network call went to the fake.
    for (const url of google.calls) expect([GOOGLE_TOKEN_URL, GOOGLE_JWKS_URL]).toContain(url)
  })

  it('the real router registers both OAuth routes', () => {
    const paths = routes.map((r) => `${r.method} ${r.path}`)
    expect(paths).toContain('GET oauth/:provider/start')
    expect(paths).toContain('GET oauth/:provider/callback')
  })

  // ------------------------------------------------------------------ 1. start

  it('start → 302 to Google with code+PKCE S256+state+nonce, sets the sealed flow cookie', async () => {
    const b = new Browser()
    const r = await start(b)
    expect(r.status).toBe(302)
    expect(r.text).toBe('')
    expect(r.headers['cache-control']).toBe('no-store')
    const url = new URL(r.location ?? '')
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const q = url.searchParams
    expect(q.get('client_id')).toBe(CLIENT_ID)
    expect(q.get('response_type')).toBe('code')
    expect(q.get('scope')).toBe('openid email profile')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(q.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(q.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(q.get('client_secret')).toBeNull()

    expect(r.cookies).toHaveLength(1)
    expect(r.cookies[0]).toMatch(FLOW_COOKIE)
    // The cookie is sealed: none of the flow secrets are readable in it.
    expect(b.oauth).toBeDefined()
    for (const secret of [q.get('state'), q.get('nonce'), q.get('code_challenge')]) expect(b.oauth).not.toContain(secret)

    // Each start is a fresh flow.
    const again = new URL((await start(new Browser())).location ?? '').searchParams
    expect(again.get('state')).not.toBe(q.get('state'))
    expect(again.get('nonce')).not.toBe(q.get('nonce'))
    expect(again.get('code_challenge')).not.toBe(q.get('code_challenge'))
    expect(google.calls).toEqual([]) // start never talks to Google
  })

  // ------------------------------------------------------------------ 2. new user

  it('callback, new user → 302 /app, session, flow cookie cleared, account created + linked, me + bridge token', async () => {
    const email = freshEmail()
    const sub = freshSub()
    const { b, r } = await googleLogin({ sub, email: email.toUpperCase(), name: '  Ann Google  ' })
    expect(r.status).toBe(302)
    expect(r.location).toBe('/app')
    expect(r.text).toBe('')
    const sessionCookie = r.cookies.find((c) => c.startsWith('__Host-session='))
    expect(sessionCookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{43};/)
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('Secure')
    expect(r.cookies.some((c) => FLOW_CLEARED.test(c))).toBe(true)
    expect(b.oauth).toBeUndefined()
    expect(b.session).toBeDefined()

    const link = await adminDb().collection('auth_accounts').doc(`google.com:${sub}`).get()
    expect(link.exists).toBe(true)
    const uid = link.get('uid') as string
    expect(link.get('provider')).toBe('google.com')
    expect(link.get('email')).toBe(email)

    const user = await userDoc(uid)
    expect(user).toMatchObject({ email, emailVerified: true, passwordHash: null, providers: ['google.com'], status: 'active', displayName: 'Ann Google' })
    const index = await adminDb().collection('auth_emails').doc(emailKey(email)).get()
    expect(index.get('uid')).toBe(uid)

    const m = await me(b)
    expect(m.status).toBe(200)
    expect(m.json.user).toMatchObject({ uid, email, emailVerified: true, providers: ['google.com'] })

    const ft = await call(b, 'POST', 'firebase-token')
    expect(ft.status).toBe(200)
    const payload = jwtPayload(ft.json.token as string)
    expect(payload.uid).toBe(uid)
    expect((payload.claims as { bb_ev?: unknown } | undefined)?.bb_ev).toBe(true)

    // Server sent the right PKCE verifier: the fake checked it against the challenge from start.
    expect(google.calls.filter((u) => u === GOOGLE_TOKEN_URL)).toHaveLength(1)
  })

  it('a session presented at the callback is replaced, not kept (no fixation)', async () => {
    const person = { sub: freshSub(), email: freshEmail() }
    const first = await googleLogin(person)
    const oldSession = first.b.session
    const second = await googleLogin(person, first.b)
    expect(second.r.location).toBe('/app')
    expect(first.b.session).not.toBe(oldSession)
    const stale = new Browser()
    stale.session = oldSession
    expect((await me(stale)).status).toBe(401)
    expect(await sessions()).toHaveLength(1)
  })

  // ------------------------------------------------------------------ 3. returning user

  it('second Google login with the same sub → same uid, no duplicate account or link', async () => {
    const person = { sub: freshSub(), email: freshEmail() }
    const one = await googleLogin(person)
    const uid1 = ((await me(one.b)).json.user as { uid: string }).uid
    const two = await googleLogin(person)
    expect(two.r.location).toBe('/app')
    const uid2 = ((await me(two.b)).json.user as { uid: string }).uid
    expect(uid2).toBe(uid1)
    expect(await users()).toHaveLength(1)
    expect(await accounts()).toHaveLength(1)
    expect((await userDoc(uid1)).providers).toEqual(['google.com'])
  })

  // ------------------------------------------------------------------ 4. linking

  it('existing VERIFIED password account (gmail.com) + Google-verified email → linked to the same uid; mail; password still works', async () => {
    const u = await seedUser({ emailVerified: true, email: gmail() })
    const sub = freshSub()
    const { b, r } = await googleLogin({ sub, email: u.email })
    expect(r.location).toBe('/app')
    const linkedMails = mail.sent.filter((m) => (m as { kind: string }).kind === 'provider-linked')
    expect(linkedMails).toHaveLength(1)
    expect(linkedMails[0]).toMatchObject({ to: u.email, provider: 'Google' })
    expect((linkedMails[0] as unknown as { device?: unknown }).device).toEqual(expect.any(String))
    expect((linkedMails[0] as unknown as { at?: unknown }).at).toEqual(expect.any(String))
    expect(((await me(b)).json.user as { uid: string }).uid).toBe(u.uid)
    const link = await adminDb().collection('auth_accounts').doc(`google.com:${sub}`).get()
    expect(link.get('uid')).toBe(u.uid)
    const user = await userDoc(u.uid)
    expect([...(user.providers as string[])].sort()).toEqual(['google.com', 'password'])
    expect(user.passwordHash).toMatch(/^\$argon2id\$/)
    expect(await users()).toHaveLength(1)

    const pw = await call(new Browser(), 'POST', 'login', { email: u.email, password: PASSWORD })
    expect(pw.status, pw.text).toBe(200)
    expect((pw.json.user as { uid: string }).uid).toBe(u.uid)
  })

  it('existing VERIFIED account at a non-Gmail domain → oauth_link_unverified, no link, no mail', async () => {
    const u = await seedUser({ emailVerified: true })
    const { r } = await googleLogin({ sub: freshSub(), email: u.email })
    expectLoginError(r, 'oauth_link_unverified')
    expect(await accounts()).toHaveLength(0)
    expect(await sessions()).toHaveLength(0)
    expect((await userDoc(u.uid)).providers).toEqual(['password'])
    expect(mail.sent).toHaveLength(0)
  })

  it('googlemail.com counts as Gmail for linking', async () => {
    const u = await seedUser({ emailVerified: true, email: `gm${Date.now()}x${++seq}@googlemail.com` })
    const { b, r } = await googleLogin({ sub: freshSub(), email: u.email })
    expect(r.location).toBe('/app')
    expect(((await me(b)).json.user as { uid: string }).uid).toBe(u.uid)
  })

  it('a new account via Google works for any domain and sends no provider-linked mail', async () => {
    const { r } = await googleLogin({ sub: freshSub(), email: freshEmail() })
    expect(r.location).toBe('/app')
    expect(mail.sent.filter((m) => (m as { kind: string }).kind === 'provider-linked')).toHaveLength(0)
  })

  describe('disabled accounts', () => {
    it('existing Google link to a disabled account → oauth_failed, no session', async () => {
      const person = { sub: freshSub(), email: freshEmail() }
      const first = await googleLogin(person)
      const uid = ((await me(first.b)).json.user as { uid: string }).uid
      await adminDb().collection('users_auth').doc(uid).update({ status: 'disabled' })
      await adminDb().recursiveDelete(adminDb().collection('sessions'))
      const { b, r } = await googleLogin(person)
      expectLoginError(r, 'oauth_failed')
      expect(b.session).toBeUndefined()
      expect(await sessions()).toHaveLength(0)
    })

    it('linking to a disabled verified Gmail account → oauth_failed, no session, no link', async () => {
      const u = await seedUser({ emailVerified: true, status: 'disabled', email: gmail() })
      const { r } = await googleLogin({ sub: freshSub(), email: u.email })
      expectLoginError(r, 'oauth_failed')
      expect(await sessions()).toHaveLength(0)
      expect(await accounts()).toHaveLength(0)
      expect((await userDoc(u.uid)).providers).toEqual(['password'])
    })
  })

  // ------------------------------------------------------------------ 5. unverified on our side

  it('existing account whose email is NOT verified on our side → oauth_link_unverified, nothing linked', async () => {
    const u = await seedUser({ emailVerified: false, email: gmail() })
    const { r } = await googleLogin({ sub: freshSub(), email: u.email })
    expectLoginError(r, 'oauth_link_unverified')
    expect(await accounts()).toHaveLength(0)
    expect(await sessions()).toHaveLength(0)
    const user = await userDoc(u.uid)
    expect(user.providers).toEqual(['password'])
    expect(user.emailVerified).toBe(false)
    expect(await users()).toHaveLength(1)
  })

  // ------------------------------------------------------------------ 6. unverified at Google

  it.each([[false], ['false'], [undefined]])('Google email_verified=%s → oauth_email_unverified, no account', async (flag) => {
    google.tamper = { email_verified: flag }
    const { r } = await googleLogin({ sub: freshSub(), email: freshEmail() })
    expectLoginError(r, 'oauth_email_unverified')
    expect(await users()).toHaveLength(0)
    expect(await accounts()).toHaveLength(0)
    expect(await sessions()).toHaveLength(0)
  })

  it('Google email_verified=false never links to an existing verified account', async () => {
    const u = await seedUser({ emailVerified: true, email: gmail() })
    google.tamper = { email_verified: false }
    const { r } = await googleLogin({ sub: freshSub(), email: u.email })
    expectLoginError(r, 'oauth_email_unverified')
    expect(await accounts()).toHaveLength(0)
    expect((await userDoc(u.uid)).providers).toEqual(['password'])
  })

  it('no email in the ID token → oauth_email_missing', async () => {
    google.tamper = { email: undefined }
    const { r } = await googleLogin({ sub: freshSub(), email: freshEmail() })
    expectLoginError(r, 'oauth_email_missing')
    expect(await users()).toHaveLength(0)
  })

  // ------------------------------------------------------------------ 7. legacy Firebase Auth

  it('email only in legacy Firebase Auth → oauth_account_exists, no twin account', async () => {
    const email = freshEmail()
    await adminAuth().createUser({ email, password: PASSWORD, emailVerified: true })
    const { r } = await googleLogin({ sub: freshSub(), email })
    expectLoginError(r, 'oauth_account_exists')
    expect(await users()).toHaveLength(0)
    expect(await accounts()).toHaveLength(0)
    expect(await sessions()).toHaveLength(0)
  })

  // ------------------------------------------------------------------ 8. state / cookie / replay

  describe('state and flow cookie', () => {
    async function prepared(): Promise<{ b: Browser; state: string; code: string }> {
      const b = new Browser()
      const s = await start(b)
      const state = new URL(s.location ?? '').searchParams.get('state') ?? ''
      const code = google.authorize(s.location ?? '', { sub: freshSub(), email: freshEmail() })
      return { b, state, code }
    }

    async function expectNothingCreated(): Promise<void> {
      expect(await users()).toHaveLength(0)
      expect(await accounts()).toHaveLength(0)
      expect(await sessions()).toHaveLength(0)
    }

    it('state mismatch → oauth_failed, code never exchanged', async () => {
      const { b, code } = await prepared()
      expectLoginError(await callback(b, { state: randomBytes(32).toString('base64url'), code }), 'oauth_failed')
      expect(google.calls).toEqual([])
      await expectNothingCreated()
    })

    it('missing state → oauth_failed', async () => {
      const { b, code } = await prepared()
      expectLoginError(await callback(b, { code }), 'oauth_failed')
      await expectNothingCreated()
    })

    it('missing code → oauth_failed', async () => {
      const { b, state } = await prepared()
      expectLoginError(await callback(b, { state }), 'oauth_failed')
      await expectNothingCreated()
    })

    it('missing flow cookie (another browser / login CSRF) → oauth_failed', async () => {
      const { state, code } = await prepared()
      expectLoginError(await callback(new Browser(), { state, code }), 'oauth_failed')
      expect(google.calls).toEqual([])
      await expectNothingCreated()
    })

    it('tampered flow cookie → oauth_failed', async () => {
      const { b, state, code } = await prepared()
      const raw = Buffer.from(b.oauth ?? '', 'base64url')
      raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1
      b.oauth = raw.toString('base64url')
      expectLoginError(await callback(b, { state, code }), 'oauth_failed')
      expect(google.calls).toEqual([])
      await expectNothingCreated()
    })

    it('garbage flow cookie → oauth_failed', async () => {
      const { b, state, code } = await prepared()
      b.oauth = 'not-a-sealed-cookie'
      expectLoginError(await callback(b, { state, code }), 'oauth_failed')
      await expectNothingCreated()
    })

    it("another browser's cookie + its own state with the victim's code → PKCE stops it", async () => {
      // Attacker starts a flow, then injects a code issued for the victim's flow (other challenge).
      const victim = await prepared()
      const attacker = new Browser()
      const s = await start(attacker)
      const attackerState = new URL(s.location ?? '').searchParams.get('state') ?? ''
      expectLoginError(await callback(attacker, { state: attackerState, code: victim.code }), 'oauth_failed')
      await expectNothingCreated()
    })

    it('expired flow (> 10 min on the consent screen) → oauth_failed', async () => {
      const { b, state, code } = await prepared()
      const t = Date.now()
      setClockForTests(() => t + 10 * 60_000 + 1000)
      try {
        expectLoginError(await callback(b, { state, code }), 'oauth_failed')
      } finally {
        setClockForTests(undefined)
      }
      await expectNothingCreated()
    })

    it('replayed callback in the same browser (cookie already cleared) → oauth_failed, one session only', async () => {
      const { b, r, state, code } = await googleLogin({ sub: freshSub(), email: freshEmail() })
      expect(r.location).toBe('/app')
      const replay = await callback(b, { state, code })
      expectLoginError(replay, 'oauth_failed')
      expect(await sessions()).toHaveLength(1)
    })

    it('replayed callback with a captured copy of the flow cookie → oauth_failed (code is single-use)', async () => {
      const b = new Browser()
      const s = await start(b)
      const captured = b.oauth
      const state = new URL(s.location ?? '').searchParams.get('state') ?? ''
      const code = google.authorize(s.location ?? '', { sub: freshSub(), email: freshEmail() })
      expect((await callback(b, { state, code })).location).toBe('/app')
      const attacker = new Browser()
      attacker.oauth = captured
      const replay = await callback(attacker, { state, code })
      expectLoginError(replay, 'oauth_failed')
      expect(attacker.session).toBeUndefined()
      expect(await sessions()).toHaveLength(1)
    })
  })

  // ------------------------------------------------------------------ 9. ID token checks

  describe('ID token', () => {
    const cases: [string, () => void][] = [
      ['nonce mismatch', () => { google.tamper = { nonce: randomBytes(32).toString('base64url') } }],
      ['no nonce', () => { google.tamper = { nonce: undefined } }],
      ['wrong aud', () => { google.tamper = { aud: 'someone-else.apps.googleusercontent.com' } }],
      ['expired', () => { const t = Math.floor(Date.now() / 1000); google.tamper = { iat: t - 300, exp: t - 120 } }],
      ['issued too long ago', () => { const t = Math.floor(Date.now() / 1000); google.tamper = { iat: t - 3600, exp: t + 3600 } }],
      ['wrong issuer', () => { google.tamper = { iss: 'https://evil.example' } }],
      ['signed by a foreign key', () => { google.key = foreignKey }],
    ]

    it.each(cases)('%s → oauth_failed, no account, no session', async (_name, arrange) => {
      arrange()
      const { r } = await googleLogin({ sub: freshSub(), email: freshEmail() })
      expectLoginError(r, 'oauth_failed')
      expect(await users()).toHaveLength(0)
      expect(await accounts()).toHaveLength(0)
      expect(await sessions()).toHaveLength(0)
    })
  })

  // ------------------------------------------------------------------ 10. cancel

  it('user cancels at Google (error=access_denied) → oauth_cancelled, flow cookie cleared', async () => {
    const b = new Browser()
    const s = await start(b)
    const state = new URL(s.location ?? '').searchParams.get('state') ?? ''
    const r = await callback(b, { error: 'access_denied', state })
    expectLoginError(r, 'oauth_cancelled')
    expect(b.oauth).toBeUndefined()
    expect(google.calls).toEqual([])
    expect(await sessions()).toHaveLength(0)
  })

  // ------------------------------------------------------------------ 11. not configured

  it('no GOOGLE_* configured → start redirects to /login?error=oauth_unavailable', async () => {
    const b = new Browser()
    const r = await start(b, unconfiguredHandler)
    expectLoginError(r, 'oauth_unavailable')
    expect(b.oauth).toBeUndefined()
  })

  it('the default (process.env) routes without GOOGLE_* also answer oauth_unavailable', async () => {
    const real = createHandler(routes, { limiter: () => new MemoryRateLimiter() })
    expectLoginError(await call(new Browser(), 'GET', 'oauth/google/start', undefined, real), 'oauth_unavailable')
  })

  it.each(['start', 'callback'])('HEAD oauth/google/%s → 405, no code exchange', async (step) => {
    const b = new Browser()
    const s = await start(b)
    const state = new URL(s.location ?? '').searchParams.get('state') ?? ''
    const code = google.authorize(s.location ?? '', { sub: freshSub(), email: freshEmail() })
    const path = step === 'start' ? 'oauth/google/start' : `oauth/google/callback?${new URLSearchParams({ state, code }).toString()}`
    const r = await call(b, 'HEAD', path)
    expect(r.status).toBe(405)
    expect(google.calls).toEqual([])
    expect(await sessions()).toHaveLength(0)
  })

  it('unknown provider → plain 404 JSON', async () => {
    const r = await call(new Browser(), 'GET', 'oauth/facebook/start')
    expect(r.status).toBe(404)
    expect((r.json.error as { code?: string }).code).toBe('not_found')
  })

  // ------------------------------------------------------------------ 12. rate limits

  it('start: 20 per 10 min per IP, the 21st → 429; another IP is unaffected', async () => {
    const ip = nextIp()
    for (let i = 0; i < 20; i++) expect((await start(new Browser(ip))).status, `start #${i + 1}`).toBe(302)
    const r = await start(new Browser(ip))
    expect(r.status).toBe(429)
    expect(r.headers['retry-after']).toBeDefined()
    expect((await start(new Browser())).status).toBe(302)
  })

  it('callback: 20 per 10 min per IP, the 21st → 429', async () => {
    const ip = nextIp()
    for (let i = 0; i < 20; i++) expect((await callback(new Browser(ip), { error: 'access_denied' })).status).toBe(302)
    expect((await callback(new Browser(ip), { error: 'access_denied' })).status).toBe(429)
  })

  // ------------------------------------------------------------------ 13. logs

  it('logs never contain the code, state, nonce, verifier, tokens, client secret or cookie values', async () => {
    const b = new Browser()
    const s = await start(b)
    const flowCookie = b.oauth ?? ''
    const q = new URL(s.location ?? '').searchParams
    const state = q.get('state') ?? ''
    const email = freshEmail()
    const code = google.authorize(s.location ?? '', { sub: freshSub(), email })
    const r = await callback(b, { state, code })
    expect(r.location).toBe('/app')
    // A failing flow too (its detail is logged).
    google.tamper = { nonce: 'x'.repeat(43) }
    await googleLogin({ sub: freshSub(), email: freshEmail() })

    const text = logs.join('\n')
    expect(logs.length).toBeGreaterThan(0)
    const secrets = [
      code, state, q.get('nonce') ?? '', q.get('code_challenge') ?? '', flowCookie, b.session ?? '',
      CLIENT_SECRET, 'ya29.fake-access-token', ...google.issuedTokens,
    ]
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(8)
      expect(text).not.toContain(secret)
      expect(text).not.toContain(secret.slice(0, 20))
    }
    for (const token of google.issuedTokens) expect(text).not.toContain(token.split('.')[1]?.slice(0, 20))
    expect(text).not.toContain(email)
    expect(text).not.toMatch(/callback\?/) // no raw query strings
  })
})
