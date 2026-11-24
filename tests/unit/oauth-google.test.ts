// ID-token verification with a locally generated RSA key served through a fake JWKS endpoint.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL, googleProvider } from '../../server/auth/oauth/google.js'
import { JwksCache } from '../../server/auth/oauth/jwt.js'
import { OAuthError, type FetchLike } from '../../server/auth/oauth/provider.js'

const CLIENT_ID = 'client-123.apps.googleusercontent.com'
const NONCE = 'n-0S6_WzA2Mj'
const NOW = 1_700_000_000_000
const NOW_S = NOW / 1000
const KID = 'test-key-1'

let privateKey: KeyObject
let otherPrivateKey: KeyObject
let publicJwk: Record<string, unknown>

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  privateKey = pair.privateKey
  publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }
  otherPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
})

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')

function makeToken(claims: Record<string, unknown> = {}, opts: { key?: KeyObject; header?: Record<string, unknown> } = {}): string {
  const header = { alg: 'RS256', kid: KID, typ: 'JWT', ...opts.header }
  const payload = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '110169484474386276334',
    email: 'Ann@Example.com',
    email_verified: true,
    name: 'Ann',
    nonce: NONCE,
    iat: NOW_S - 5,
    exp: NOW_S + 3600,
    ...claims,
  }
  const input = `${b64(header)}.${b64(payload)}`
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), opts.key ?? privateKey).toString('base64url')}`
}

function fakeFetch(calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url)
    if (url === GOOGLE_JWKS_URL) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'cache-control': 'public, max-age=600' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
}

function provider(fetchImpl: FetchLike = fakeFetch(), now = () => NOW) {
  return googleProvider({ clientId: CLIENT_ID, clientSecret: 'secret' }, { fetch: fetchImpl, now, jwks: new JwksCache(GOOGLE_JWKS_URL, fetchImpl, now) })
}

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'accepted'
  } catch (err) {
    return err instanceof OAuthError ? err.reason : `unexpected: ${String(err)}`
  }
}

describe('Google ID-token verification', () => {
  it('accepts a valid token and returns the normalized identity', async () => {
    const id = await provider().verifyIdToken(makeToken(), { nonce: NONCE })
    expect(id).toEqual({ providerId: 'google.com', sub: '110169484474386276334', email: 'ann@example.com', emailVerified: true, name: 'Ann' })
  })

  it('accepts the legacy issuer form "accounts.google.com"', async () => {
    expect(await reason(provider().verifyIdToken(makeToken({ iss: 'accounts.google.com' }), { nonce: NONCE }))).toBe('accepted')
  })

  it.each([
    ['expired', { exp: NOW_S - 120 }],
    ['wrong audience', { aud: 'someone-else.apps.googleusercontent.com' }],
    ['wrong issuer', { iss: 'https://evil.example.com' }],
    ['issued in the future', { iat: NOW_S + 600 }],
    ['too old', { iat: NOW_S - 3600 }],
    ['nonce mismatch', { nonce: 'other-nonce' }],
    ['missing nonce', { nonce: undefined }],
    ['multi-audience without azp = us', { aud: [CLIENT_ID, 'other'], azp: 'other' }],
  ])('rejects a token that is %s', async (_label, claims) => {
    expect(await reason(provider().verifyIdToken(makeToken(claims), { nonce: NONCE }))).toBe('invalid_token')
  })

  it('tolerates a small clock skew on exp', async () => {
    expect(await reason(provider().verifyIdToken(makeToken({ exp: NOW_S - 30 }), { nonce: NONCE }))).toBe('accepted')
  })

  it('rejects an address Google has not verified', async () => {
    expect(await reason(provider().verifyIdToken(makeToken({ email_verified: false }), { nonce: NONCE }))).toBe('email_unverified')
    expect(await reason(provider().verifyIdToken(makeToken({ email_verified: undefined }), { nonce: NONCE }))).toBe('email_unverified')
  })

  it('rejects a token without an email', async () => {
    expect(await reason(provider().verifyIdToken(makeToken({ email: undefined }), { nonce: NONCE }))).toBe('email_missing')
  })

  it('rejects a bad signature, alg confusion, unknown kid and garbage', async () => {
    const p = provider()
    expect(await reason(p.verifyIdToken(makeToken({}, { key: otherPrivateKey }), { nonce: NONCE }))).toBe('invalid_token')
    expect(await reason(p.verifyIdToken(makeToken({}, { header: { alg: 'HS256' } }), { nonce: NONCE }))).toBe('invalid_token')
    expect(await reason(p.verifyIdToken(makeToken({}, { header: { alg: 'none' } }), { nonce: NONCE }))).toBe('invalid_token')
    expect(await reason(p.verifyIdToken(makeToken({}, { header: { kid: 'unknown' } }), { nonce: NONCE }))).toBe('invalid_token')
    expect(await reason(p.verifyIdToken('a.b', { nonce: NONCE }))).toBe('invalid_token')
    // Payload swapped after signing.
    const [h, , s] = makeToken().split('.')
    const forged = `${h}.${b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1', nonce: NONCE, iat: NOW_S, exp: NOW_S + 60 })}.${s}`
    expect(await reason(p.verifyIdToken(forged, { nonce: NONCE }))).toBe('invalid_token')
  })

  it('caches the JWKS and refetches at most once a minute for an unknown kid', async () => {
    const calls: string[] = []
    let t = NOW
    const clock = () => t
    const p = provider(fakeFetch(calls), clock)
    await p.verifyIdToken(makeToken(), { nonce: NONCE })
    await p.verifyIdToken(makeToken(), { nonce: NONCE })
    expect(calls).toHaveLength(1)
    await reason(p.verifyIdToken(makeToken({}, { header: { kid: 'rotated' } }), { nonce: NONCE }))
    expect(calls).toHaveLength(1)
    t += 61_000
    await reason(p.verifyIdToken(makeToken({}, { header: { kid: 'rotated' } }), { nonce: NONCE }))
    expect(calls).toHaveLength(2)
  })

  it('reports an unreachable JWKS as a provider error', async () => {
    const down: FetchLike = async () => { throw new Error('offline') }
    expect(await reason(provider(down).verifyIdToken(makeToken(), { nonce: NONCE }))).toBe('provider_error')
  })
})

describe('Google authorize URL and code exchange', () => {
  it('builds an authorization-code request with PKCE S256, state and nonce', () => {
    const url = new URL(provider().authorizeUrl({ state: 'st', nonce: 'nn', codeChallenge: 'cc', redirectUri: 'https://bullbir.app/api/auth/oauth/google/callback' }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const q = Object.fromEntries(url.searchParams)
    expect(q).toMatchObject({
      client_id: CLIENT_ID, response_type: 'code', scope: 'openid email profile', state: 'st', nonce: 'nn',
      code_challenge: 'cc', code_challenge_method: 'S256', redirect_uri: 'https://bullbir.app/api/auth/oauth/google/callback',
    })
  })

  it('posts the code with the PKCE verifier and returns the id_token', async () => {
    let sent: URLSearchParams | undefined
    const fetchImpl: FetchLike = async (url, init) => {
      expect(url).toBe(GOOGLE_TOKEN_URL)
      expect(init?.method).toBe('POST')
      sent = new URLSearchParams(String(init?.body))
      return new Response(JSON.stringify({ id_token: 'tok', access_token: 'at' }))
    }
    const out = await provider(fetchImpl).exchange({ code: 'c0de', codeVerifier: 'ver', redirectUri: 'https://x/cb' })
    expect(out).toEqual({ idToken: 'tok' })
    expect(Object.fromEntries(sent ?? [])).toMatchObject({
      code: 'c0de', code_verifier: 'ver', grant_type: 'authorization_code', client_id: CLIENT_ID, client_secret: 'secret', redirect_uri: 'https://x/cb',
    })
  })

  it('turns token endpoint failures into provider_error', async () => {
    const bad: FetchLike = async () => new Response('{"error":"invalid_grant"}', { status: 400 })
    expect(await reason(provider(bad).exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }))).toBe('provider_error')
    const noToken: FetchLike = async () => new Response('{}')
    expect(await reason(provider(noToken).exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }))).toBe('provider_error')
  })
})
