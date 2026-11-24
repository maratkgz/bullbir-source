// The OAuth 2.0 / OpenID Connect provider contract. Google is the first implementation; Apple
// plugs in later as one more file implementing the same interface (docs/auth-migration-plan.md).
// The flow around it (state, PKCE, nonce, account linking, session) is provider-independent.

/** What a provider tells us about the person after a verified sign-in. */
export type OAuthIdentity = {
  /** Stored in users_auth.providers and in auth_accounts ids, e.g. 'google.com'. */
  providerId: string
  /** The provider's stable user id (`sub` claim). Never the email. */
  sub: string
  /** Normalized address (see server/auth/email.ts). */
  email: string
  emailVerified: boolean
  name: string | null
}

export type AuthorizeParams = {
  state: string
  nonce: string
  /** PKCE S256 challenge of the verifier kept in the flow cookie. */
  codeChallenge: string
  redirectUri: string
}

export type ExchangeParams = {
  code: string
  codeVerifier: string
  redirectUri: string
}

export interface OAuthProvider {
  /** URL segment: /api/auth/oauth/:id/start, e.g. 'google'. */
  readonly id: string
  /** Account-level provider id, e.g. 'google.com'. */
  readonly providerId: string
  /** Where to send the browser to sign in. */
  authorizeUrl(params: AuthorizeParams): string
  /** Back-channel code → tokens exchange (with the PKCE verifier and client secret). */
  exchange(params: ExchangeParams): Promise<{ idToken: string }>
  /** Verifies signature, issuer, audience, lifetime and nonce, then returns the identity. */
  verifyIdToken(idToken: string, expected: { nonce: string }): Promise<OAuthIdentity>
}

/** Why a sign-in was refused. Mapped to `/login?error=…` codes by the route. */
export type OAuthFailure =
  | 'cancelled'
  | 'invalid_state'
  | 'provider_error'
  | 'invalid_token'
  | 'email_missing'
  | 'email_unverified'
  | 'link_unverified'
  | 'account_exists'
  | 'unavailable'

export class OAuthError extends Error {
  readonly reason: OAuthFailure

  constructor(reason: OAuthFailure, message?: string) {
    super(message ?? reason)
    this.name = 'OAuthError'
    this.reason = reason
  }
}

export function isOAuthError(value: unknown): value is OAuthError {
  return value instanceof OAuthError
}

/** Minimal fetch signature so tests can inject a fake network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
