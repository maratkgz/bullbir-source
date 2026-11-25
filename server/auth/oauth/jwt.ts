// ID-token (JWT) verification with node:crypto only: RS256 signature against the provider's JWKS,
// then the OpenID Connect claim checks. Shared by every provider (Google now, Apple later — both
// sign with RS256 and publish a JWKS).
import { createPublicKey, timingSafeEqual, verify, type JsonWebKey, type KeyObject } from 'node:crypto'
import { OAuthError, type FetchLike } from './provider.js'

const MAX_TOKEN_LENGTH = 8192
const B64URL = /^[A-Za-z0-9_-]+$/
const FETCH_TIMEOUT_MS = 5000
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000
const MAX_JWKS_TTL_MS = 24 * 60 * 60 * 1000
/** An unknown `kid` may trigger a refetch (key rotation), but not more often than this. */
const MIN_REFETCH_MS = 60 * 1000

export type JwtHeader = Record<string, unknown>
export type JwtClaims = Record<string, unknown>

type DecodedJwt = { header: JwtHeader; payload: JwtClaims; signingInput: string; signature: Buffer }

function invalid(message: string): OAuthError {
  return new OAuthError('invalid_token', message)
}

function decodeJson(part: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    throw invalid('Malformed JWT segment')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('JWT segment is not an object')
  return value as Record<string, unknown>
}

export function decodeJwt(token: string): DecodedJwt {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) throw invalid('Token missing or too long')
  const parts = token.split('.')
  if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) throw invalid('Not a compact JWS')
  const [h, p, s] = parts as [string, string, string]
  return { header: decodeJson(h), payload: decodeJson(p), signingInput: `${h}.${p}`, signature: Buffer.from(s, 'base64url') }
}

type Jwk = JsonWebKey & { kid?: unknown; kty?: unknown; use?: unknown; alg?: unknown }

function isUsableRsaKey(k: Jwk): k is Jwk & { kid: string } {
  return typeof k.kid === 'string' && k.kty === 'RSA'
    && (k.use === undefined || k.use === 'sig') && (k.alg === undefined || k.alg === 'RS256')
}

function maxAgeMs(cacheControl: string | null): number {
  const m = /max-age=(\d+)/i.exec(cacheControl ?? '')
  if (!m?.[1]) return DEFAULT_JWKS_TTL_MS
  return Math.min(Number(m[1]) * 1000, MAX_JWKS_TTL_MS)
}

/** Caches a provider's signing keys in memory (per serverless instance), honouring max-age. */
export class JwksCache {
  private keys = new Map<string, KeyObject>()
  private expiresAt = 0
  private fetchedAt = Number.NEGATIVE_INFINITY
  private readonly url: string
  private readonly fetchImpl: FetchLike
  private readonly clock: () => number

  constructor(url: string, fetchImpl: FetchLike = (input, init) => fetch(input, { ...init, redirect: 'error' }), clock: () => number = Date.now) {
    this.url = url
    this.fetchImpl = fetchImpl
    this.clock = clock
  }

  async key(kid: string): Promise<KeyObject | null> {
    const t = this.clock()
    const fresh = t < this.expiresAt
    const cached = this.keys.get(kid)
    if (cached && fresh) return cached
    if (fresh && t - this.fetchedAt < MIN_REFETCH_MS) return null
    await this.refresh()
    return this.keys.get(kid) ?? null
  }

  private async refresh(): Promise<void> {
    let res: Response
    try {
      res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    } catch {
      throw new OAuthError('provider_error', 'JWKS fetch failed')
    }
    if (!res.ok) throw new OAuthError('provider_error', `JWKS fetch returned ${res.status}`)
    const body = (await res.json().catch(() => null)) as { keys?: unknown } | null
    if (!body || !Array.isArray(body.keys)) throw new OAuthError('provider_error', 'JWKS has no keys')

    const next = new Map<string, KeyObject>()
    for (const jwk of body.keys as Jwk[]) {
      if (!jwk || typeof jwk !== 'object' || !isUsableRsaKey(jwk)) continue
      try {
        next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }))
      } catch {
        // A malformed key is skipped; tokens signed with it simply fail verification.
      }
    }
    const t = this.clock()
    this.keys = next
    this.fetchedAt = t
    this.expiresAt = t + maxAgeMs(res.headers.get('cache-control'))
  }
}

export type ClaimRules = {
  issuers: readonly string[]
  audience: string
  nonce: string
  /** Current time, ms since epoch. */
  now: number
  /** Allowed clock difference with the provider. */
  skewSeconds: number
  /** Reject tokens issued longer ago than this (they are minted seconds before we see them). */
  maxAgeSeconds: number
}

function safeEqualText(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb)
}

/** The OpenID Connect Core §3.1.3.7 checks that do not need the signature. */
export function checkClaims(payload: JwtClaims, rules: ClaimRules): void {
  const nowSec = Math.floor(rules.now / 1000)
  if (typeof payload.iss !== 'string' || !rules.issuers.includes(payload.iss)) throw invalid('Wrong issuer')

  const aud = payload.aud
  const audiences: unknown[] = Array.isArray(aud) ? aud : [aud]
  if (!audiences.includes(rules.audience)) throw invalid('Wrong audience')
  // Several audiences: the authorized party must be us (OIDC Core §3.1.3.7 steps 4–5).
  if (audiences.length > 1 && payload.azp !== rules.audience) throw invalid('Wrong authorized party')

  if (typeof payload.exp !== 'number' || nowSec >= payload.exp + rules.skewSeconds) throw invalid('Token expired')
  if (typeof payload.iat !== 'number') throw invalid('Missing iat')
  if (payload.iat > nowSec + rules.skewSeconds) throw invalid('Token issued in the future')
  if (payload.iat < nowSec - rules.maxAgeSeconds) throw invalid('Token too old')

  if (typeof payload.nonce !== 'string' || !safeEqualText(payload.nonce, rules.nonce)) throw invalid('Nonce mismatch')
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) throw invalid('Bad subject')
}

/** Verifies an RS256 ID token's signature against the JWKS and its claims. Returns the claims. */
export async function verifyIdToken(token: string, jwks: JwksCache, rules: ClaimRules): Promise<JwtClaims> {
  const { header, payload, signingInput, signature } = decodeJwt(token)
  // Pin the algorithm: never trust `alg` to pick it (no 'none', no HS256 with the public key).
  if (header.alg !== 'RS256') throw invalid('Unexpected algorithm')
  if (typeof header.kid !== 'string' || !header.kid) throw invalid('Missing key id')

  const key = await jwks.key(header.kid)
  if (!key) throw invalid('Unknown signing key')
  const ok = verify('RSA-SHA256', Buffer.from(signingInput, 'utf8'), key, signature)
  if (!ok) throw invalid('Bad signature')

  checkClaims(payload, rules)
  return payload
}
