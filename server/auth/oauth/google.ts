// Google as an OpenID Connect provider: Authorization Code + PKCE (S256) + state + nonce.
// Docs: https://developers.google.com/identity/openid-connect/openid-connect
import { normalizeEmail } from '../email.js'
import { JwksCache, verifyIdToken } from './jwt.js'
import { OAuthError, type FetchLike, type OAuthIdentity, type OAuthProvider } from './provider.js'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const

const SCOPES = 'openid email profile'
const TOKEN_TIMEOUT_MS = 10_000
const CLOCK_SKEW_SECONDS = 60
const MAX_TOKEN_AGE_SECONDS = 10 * 60
const NAME_MAX = 80
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type GoogleConfig = { clientId: string; clientSecret: string }

export type GoogleDeps = {
  fetch?: FetchLike
  now?: () => number
  jwks?: JwksCache
}

/** One JWKS cache per warm serverless instance. */
let sharedJwks: JwksCache | undefined

function identityFrom(claims: Record<string, unknown>): OAuthIdentity {
  if (typeof claims.email !== 'string' || !claims.email) throw new OAuthError('email_missing', 'No email in ID token')
  const email = normalizeEmail(claims.email)
  if (email.length > 254 || !EMAIL.test(email)) throw new OAuthError('email_missing', 'Unusable email in ID token')
  // Google sends a boolean; older tokens used the string "true".
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true'
  if (!emailVerified) throw new OAuthError('email_unverified', 'Google has not verified this email')
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, NAME_MAX) : null
  return { providerId: 'google.com', sub: String(claims.sub), email, emailVerified, name }
}

export function googleProvider(config: GoogleConfig, deps: GoogleDeps = {}): OAuthProvider {
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init))
  const now = deps.now ?? Date.now
  const jwks = deps.jwks ?? (sharedJwks ??= new JwksCache(GOOGLE_JWKS_URL))

  return {
    id: 'google',
    providerId: 'google.com',

    authorizeUrl({ state, nonce, codeChallenge, redirectUri }) {
      const url = new URL(GOOGLE_AUTH_URL)
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString()
      return url.toString()
    },

    async exchange({ code, codeVerifier, redirectUri }) {
      let res: Response
      try {
        res = await fetchImpl(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier,
          }).toString(),
          signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
        })
      } catch {
        throw new OAuthError('provider_error', 'Token endpoint unreachable')
      }
      // Error bodies (invalid_grant…) are not logged: they can echo request data.
      if (!res.ok) throw new OAuthError('provider_error', `Token endpoint returned ${res.status}`)
      const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null
      if (!body || typeof body.id_token !== 'string') throw new OAuthError('provider_error', 'No id_token in response')
      return { idToken: body.id_token }
    },

    async verifyIdToken(idToken, { nonce }) {
      const claims = await verifyIdToken(idToken, jwks, {
        issuers: GOOGLE_ISSUERS,
        audience: config.clientId,
        nonce,
        now: now(),
        skewSeconds: CLOCK_SKEW_SECONDS,
        maxAgeSeconds: MAX_TOKEN_AGE_SECONDS,
      })
      return identityFrom(claims)
    },
  }
}
