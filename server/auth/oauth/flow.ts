// Per-sign-in secrets (state, nonce, PKCE verifier) live in ONE short-lived cookie, `__Host-oauth`,
// sealed with AES-256-GCM (confidential + tamper-proof) under a key derived from AUTH_PEPPER.
// Nothing is written to the database, and the callback (a cross-site top-level GET that skips the
// Origin check) only succeeds in the browser that started the flow:
//   - state in the URL must equal state in the cookie  → stops login CSRF / code injection
//   - PKCE verifier never leaves the server/cookie      → a stolen code is useless alone
//   - nonce must come back inside the signed ID token    → stops ID-token replay
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { header } from '../../http.js'
import { OAuthError } from './provider.js'

export const OAUTH_COOKIE = '__Host-oauth'
/** How long the user may spend on the provider's consent screen. */
export const FLOW_TTL_MS = 10 * 60 * 1000

const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const AAD = Buffer.from('bullbir-oauth-flow-v1')
const MAX_COOKIE_LENGTH = 2048
const B64URL = /^[A-Za-z0-9_-]+$/

export type FlowState = {
  provider: string
  state: string
  nonce: string
  codeVerifier: string
  /** ms since epoch */
  expiresAt: number
}

/** 32 random bytes, base64url (43 chars) — valid as state, nonce and PKCE verifier (RFC 7636 §4.1). */
function random43(): string {
  return randomBytes(32).toString('base64url')
}

/** RFC 7636 §4.2, method S256: BASE64URL(SHA256(ASCII(code_verifier))). */
export function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url')
}

export function newFlow(provider: string, nowMs: number): FlowState {
  return { provider, state: random43(), nonce: random43(), codeVerifier: random43(), expiresAt: nowMs + FLOW_TTL_MS }
}

function cookieKey(pepperBase64: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(pepperBase64, 'base64'), 'bullbir-oauth', 'oauth-flow-cookie-v1', 32))
}

export function sealFlow(flow: FlowState, pepperBase64: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', cookieKey(pepperBase64), iv)
  cipher.setAAD(AAD)
  const plain = Buffer.from(JSON.stringify({ v: VERSION, ...flow }), 'utf8')
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64url')
}

function isFlow(value: unknown): value is FlowState & { v: number } {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.v === VERSION && typeof v.provider === 'string' && typeof v.state === 'string'
    && typeof v.nonce === 'string' && typeof v.codeVerifier === 'string' && typeof v.expiresAt === 'number'
}

/** Opens a sealed flow cookie. Any tampering, foreign key or expiry → invalid_state. */
export function openFlow(sealed: string | undefined, pepperBase64: string, nowMs: number): FlowState {
  if (!sealed || sealed.length > MAX_COOKIE_LENGTH || !B64URL.test(sealed)) {
    throw new OAuthError('invalid_state', 'Flow cookie missing')
  }
  const raw = Buffer.from(sealed, 'base64url')
  if (raw.length <= IV_BYTES + TAG_BYTES) throw new OAuthError('invalid_state', 'Flow cookie too short')
  let parsed: unknown
  try {
    const decipher = createDecipheriv('aes-256-gcm', cookieKey(pepperBase64), raw.subarray(0, IV_BYTES))
    decipher.setAAD(AAD)
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()])
    parsed = JSON.parse(plain.toString('utf8'))
  } catch {
    throw new OAuthError('invalid_state', 'Flow cookie rejected')
  }
  if (!isFlow(parsed)) throw new OAuthError('invalid_state', 'Flow cookie malformed')
  if (nowMs >= parsed.expiresAt) throw new OAuthError('invalid_state', 'Flow expired')
  const { provider, state, nonce, codeVerifier, expiresAt } = parsed
  return { provider, state, nonce, codeVerifier, expiresAt }
}

function safeEqualText(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb)
}

/** The callback must be for the provider that was started, with the exact state we issued. */
export function assertCallbackMatches(flow: FlowState, callback: { provider: string; state: string | null }): void {
  if (flow.provider !== callback.provider) throw new OAuthError('invalid_state', 'Provider mismatch')
  if (!callback.state || !safeEqualText(flow.state, callback.state)) throw new OAuthError('invalid_state', 'State mismatch')
}

export function readFlowCookie(req: IncomingMessage): string | undefined {
  const raw = header(req, 'cookie')
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === OAUTH_COOKIE) return part.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * SameSite=Lax is enough for Google: the callback is a top-level GET navigation, on which Lax
 * cookies are sent. (Apple's form_post callback is a cross-site POST and will need SameSite=None.)
 */
export function flowCookie(sealed: string): string {
  return `${OAUTH_COOKIE}=${sealed}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(FLOW_TTL_MS / 1000)}`
}

export function clearFlowCookie(): string {
  return `${OAUTH_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
