import { describe, expect, it } from 'vitest'
import {
  assertCallbackMatches,
  clearFlowCookie,
  flowCookie,
  FLOW_TTL_MS,
  newFlow,
  OAUTH_COOKIE,
  openFlow,
  pkceChallenge,
  readFlowCookie,
  sealFlow,
} from '../../server/auth/oauth/flow.js'
import { OAuthError } from '../../server/auth/oauth/provider.js'
import type { IncomingMessage } from 'node:http'

const PEPPER = Buffer.alloc(32, 7).toString('base64')
const OTHER_PEPPER = Buffer.alloc(32, 8).toString('base64')
const T0 = 1_700_000_000_000

function reason(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof OAuthError ? err.reason : `unexpected: ${String(err)}`
  }
  return undefined
}

describe('PKCE', () => {
  it('matches the RFC 7636 Appendix B test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generates 43-char unreserved verifiers, state and nonce, all different', () => {
    const f = newFlow('google', T0)
    for (const v of [f.codeVerifier, f.state, f.nonce]) expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(new Set([f.codeVerifier, f.state, f.nonce]).size).toBe(3)
    expect(newFlow('google', T0).state).not.toBe(f.state)
    expect(f.expiresAt).toBe(T0 + FLOW_TTL_MS)
  })
})

describe('sealed flow cookie', () => {
  it('round-trips and hides the verifier', () => {
    const flow = newFlow('google', T0)
    const sealed = sealFlow(flow, PEPPER)
    expect(sealed).not.toContain(flow.codeVerifier)
    expect(Buffer.from(sealed, 'base64url').toString('latin1')).not.toContain(flow.codeVerifier)
    expect(openFlow(sealed, PEPPER, T0 + 1000)).toEqual(flow)
  })

  it('rejects a missing, tampered, foreign-key or expired cookie', () => {
    const sealed = sealFlow(newFlow('google', T0), PEPPER)
    const bytes = Buffer.from(sealed, 'base64url')
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1
    const tampered = bytes.toString('base64url')

    expect(reason(() => openFlow(undefined, PEPPER, T0))).toBe('invalid_state')
    expect(reason(() => openFlow('not*base64', PEPPER, T0))).toBe('invalid_state')
    expect(reason(() => openFlow(tampered, PEPPER, T0))).toBe('invalid_state')
    expect(reason(() => openFlow(sealed, OTHER_PEPPER, T0))).toBe('invalid_state')
    expect(reason(() => openFlow(sealed, PEPPER, T0 + FLOW_TTL_MS))).toBe('invalid_state')
  })
})

describe('callback binding', () => {
  const flow = newFlow('google', T0)

  it('accepts the exact state for the same provider', () => {
    expect(reason(() => assertCallbackMatches(flow, { provider: 'google', state: flow.state }))).toBeUndefined()
  })

  it('rejects a state mismatch, a missing state and a different provider', () => {
    expect(reason(() => assertCallbackMatches(flow, { provider: 'google', state: `${flow.state.slice(0, -1)}x` }))).toBe('invalid_state')
    expect(reason(() => assertCallbackMatches(flow, { provider: 'google', state: null }))).toBe('invalid_state')
    expect(reason(() => assertCallbackMatches(flow, { provider: 'apple', state: flow.state }))).toBe('invalid_state')
  })
})

describe('cookie strings', () => {
  it('uses a __Host- cookie: Secure, HttpOnly, Path=/, no Domain, Lax, short-lived', () => {
    const c = flowCookie('abc')
    expect(c.startsWith(`${OAUTH_COOKIE}=abc;`)).toBe(true)
    expect(c).toContain('Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600')
    expect(c).not.toMatch(/Domain=/i)
    expect(clearFlowCookie()).toContain('Max-Age=0')
  })

  it('reads only the oauth cookie from the Cookie header', () => {
    const req = { headers: { cookie: `__Host-session=zzz; ${OAUTH_COOKIE}=sealed-value; x=1` } } as unknown as IncomingMessage
    expect(readFlowCookie(req)).toBe('sealed-value')
    expect(readFlowCookie({ headers: {} } as unknown as IncomingMessage)).toBeUndefined()
  })
})
