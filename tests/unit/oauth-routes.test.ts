// The two OAuth routes end to end, with Google's endpoints faked and Firestore replaced by stubs.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { OAUTH_COOKIE } from '../../server/auth/oauth/flow.js'
import { GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL } from '../../server/auth/oauth/google.js'
import { JwksCache } from '../../server/auth/oauth/jwt.js'
import type { FetchLike, OAuthIdentity } from '../../server/auth/oauth/provider.js'
import { OAuthError } from '../../server/auth/oauth/provider.js'
import type { ApiRequest } from '../../server/http.js'
import { MemoryRateLimiter } from '../../server/rateLimit.js'
import type { RequestContext, RouteResult } from '../../server/router.js'
import { createOAuthRoutes, type OAuthRouteDeps } from '../../server/routes/oauth.js'
import { AppError } from '../../server/errors.js'

const ORIGIN = 'https://bullbir.app'
const CLIENT_ID = 'cid.apps.googleusercontent.com'
const NOW = 1_700_000_000_000
const SOURCE = { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'csecret' }
const env = { APP_ORIGINS: [ORIGIN], AUTH_PEPPER: Buffer.alloc(32, 3).toString('base64') }

let key: KeyObject
let jwk: Record<string, unknown>

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  key = pair.privateKey
  jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
})

function idToken(nonce: string, extra: Record<string, unknown> = {}): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const input = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '42', email: 'ann@example.com', email_verified: true,
    nonce, iat: NOW / 1000, exp: NOW / 1000 + 3600, ...extra,
  })}`
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`
}

type Google = { tokenFor: (code: string) => string; exchanges: URLSearchParams[] }

function fakeGoogle(google: Google): FetchLike {
  return async (url, init) => {
    if (url === GOOGLE_JWKS_URL) return new Response(JSON.stringify({ keys: [jwk] }))
    if (url === GOOGLE_TOKEN_URL) {
      const body = new URLSearchParams(String(init?.body))
      google.exchanges.push(body)
      return new Response(JSON.stringify({ id_token: google.tokenFor(body.get('code') ?? '') }))
    }
    throw new Error(`unexpected ${url}`)
  }
}

function ctx(path: string, cookie?: string): RequestContext {
  const url = `/api/auth/oauth/${path}`
  const provider = path.split('/')[0] ?? ''
  const req = { method: 'GET', url, headers: cookie ? { cookie } : {} } as unknown as ApiRequest
  return {
    req, env: env as unknown as RequestContext['env'], ipKey: '198.51.100.10', ipPrefix: '198.51.100.0',
    limiter: new MemoryRateLimiter(), requestId: 'rid', params: { provider },
  }
}

function setup(over: Partial<OAuthRouteDeps> & { nonceOverride?: string } = {}) {
  const google: Google = { tokenFor: () => '', exchanges: [] }
  const fetchImpl = fakeGoogle(google)
  const resolved: OAuthIdentity[] = []
  const routes = createOAuthRoutes({
    source: SOURCE,
    now: () => NOW,
    providers: { google: { fetch: fetchImpl, now: () => NOW, jwks: new JwksCache(GOOGLE_JWKS_URL, fetchImpl, () => NOW) } },
    resolveAccount: async (identity) => { resolved.push(identity); return { uid: 'uid-1', created: true, linked: true } },
    startSession: async (uid) => `__Host-session=session-for-${uid}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ...over,
  })
  return { routes, google, resolved }
}

const cookies = (r: RouteResult): string[] => [r.headers?.['Set-Cookie'] ?? []].flat()
const location = (r: RouteResult): string => String(r.headers?.Location)

/** Runs /start and returns what the browser would carry to the callback. */
async function begin(routes: ReturnType<typeof setup>['routes']) {
  const res = await routes.start.handler(ctx('google/start'))
  const url = new URL(location(res))
  const flowCookie = cookies(res).find((c) => c.startsWith(`${OAUTH_COOKIE}=`)) ?? ''
  return { res, url, cookie: flowCookie.split(';')[0] ?? '', state: url.searchParams.get('state') ?? '', nonce: url.searchParams.get('nonce') ?? '' }
}

describe('GET oauth/google/start', () => {
  it('redirects to Google with PKCE and sets the sealed __Host-oauth cookie', async () => {
    const { routes } = setup()
    const { res, url, cookie } = await begin(routes)
    expect(res.status).toBe(302)
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/oauth/google/callback`)
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cookie.startsWith(`${OAUTH_COOKIE}=`)).toBe(true)
    expect(res.headers?.['Referrer-Policy']).toBe('no-referrer')
  })

  it('redirects to /login?error=oauth_unavailable when Google keys are missing', async () => {
    const { routes } = setup({ source: {} })
    const res = await routes.start.handler(ctx('google/start'))
    expect(res.status).toBe(302)
    expect(location(res)).toBe('/login?error=oauth_unavailable')
  })

  it('404s for an unknown provider', async () => {
    const { routes } = setup()
    await expect(routes.start.handler(ctx('myspace/start'))).rejects.toBeInstanceOf(AppError)
  })
})

describe('GET oauth/google/callback', () => {
  it('signs in: exchanges the code with the verifier, verifies the nonce, sets the session', async () => {
    const { routes, google, resolved } = setup()
    const flow = await begin(routes)
    google.tokenFor = () => idToken(flow.nonce)

    const res = await routes.callback.handler(ctx(`google/callback?code=abc&state=${flow.state}`, flow.cookie))
    expect(res.status).toBe(302)
    expect(location(res)).toBe('/app')
    expect(cookies(res)).toEqual([expect.stringMatching(/^__Host-oauth=; .*Max-Age=0/), expect.stringMatching(/^__Host-session=session-for-uid-1/)])
    expect(resolved[0]).toMatchObject({ providerId: 'google.com', sub: '42', email: 'ann@example.com' })
    const sent = google.exchanges[0]
    expect(sent?.get('code')).toBe('abc')
    expect(sent?.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it.each([
    ['state mismatch', (f: { state: string; cookie: string }) => ctx(`google/callback?code=abc&state=${f.state}x`, f.cookie)],
    ['missing state', (f: { state: string; cookie: string }) => ctx('google/callback?code=abc', f.cookie)],
    ['no flow cookie (another browser)', (f: { state: string; cookie: string }) => ctx(`google/callback?code=abc&state=${f.state}`)],
    ['missing code', (f: { state: string; cookie: string }) => ctx(`google/callback?state=${f.state}`, f.cookie)],
  ])('refuses on %s without calling Google', async (_label, build) => {
    const { routes, google } = setup()
    const flow = await begin(routes)
    const res = await routes.callback.handler(build(flow))
    expect(location(res)).toBe('/login?error=oauth_failed')
    expect(cookies(res)).toEqual([expect.stringMatching(/^__Host-oauth=; .*Max-Age=0/)])
    expect(google.exchanges).toHaveLength(0)
  })

  it('refuses an ID token whose nonce does not match the flow', async () => {
    const { routes, google, resolved } = setup()
    const flow = await begin(routes)
    google.tokenFor = () => idToken('attacker-nonce')
    const res = await routes.callback.handler(ctx(`google/callback?code=abc&state=${flow.state}`, flow.cookie))
    expect(location(res)).toBe('/login?error=oauth_failed')
    expect(resolved).toHaveLength(0)
  })

  it('maps a user cancel to oauth_cancelled', async () => {
    const { routes } = setup()
    const flow = await begin(routes)
    const res = await routes.callback.handler(ctx(`google/callback?error=access_denied&state=${flow.state}`, flow.cookie))
    expect(location(res)).toBe('/login?error=oauth_cancelled')
  })

  it('maps a refused link to oauth_link_unverified and sets no session', async () => {
    const { routes, google } = setup({ resolveAccount: async () => { throw new OAuthError('link_unverified') } })
    const flow = await begin(routes)
    google.tokenFor = () => idToken(flow.nonce)
    const res = await routes.callback.handler(ctx(`google/callback?code=abc&state=${flow.state}`, flow.cookie))
    expect(location(res)).toBe('/login?error=oauth_link_unverified')
    expect(cookies(res).some((c) => c.startsWith('__Host-session='))).toBe(false)
  })

  it('maps an unexpected failure (e.g. database down) to oauth_failed', async () => {
    const { routes, google } = setup({ resolveAccount: async () => { throw new Error('firestore down') } })
    const flow = await begin(routes)
    google.tokenFor = () => idToken(flow.nonce)
    const res = await routes.callback.handler(ctx(`google/callback?code=abc&state=${flow.state}`, flow.cookie))
    expect(location(res)).toBe('/login?error=oauth_failed')
  })
})
