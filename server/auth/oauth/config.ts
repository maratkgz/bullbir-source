// OAuth settings and the provider registry. Read from process.env here for now; the lead may move
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / OAUTH_REDIRECT_BASE into server/env.ts (zod) later.
// A provider without keys is simply "unavailable" — the rest of auth keeps working.
import type { ServerEnv } from '../../env.js'
import { googleProvider, type GoogleDeps } from './google.js'
import { OAuthError, type OAuthProvider } from './provider.js'

/** Every provider id the routes know (URL segment). Apple will be added here. */
export const KNOWN_PROVIDERS = ['google'] as const
export type ProviderId = (typeof KNOWN_PROVIDERS)[number]

export type OAuthConfig = {
  /** Origin the provider redirects back to and where the session cookie is set. */
  redirectBase: string
  google: { clientId: string; clientSecret: string } | null
}

export function isKnownProvider(id: string): id is ProviderId {
  return (KNOWN_PROVIDERS as readonly string[]).includes(id)
}

function nonEmpty(value: string | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

/**
 * OAUTH_REDIRECT_BASE (optional) must be one of APP_ORIGINS — the session cookie has to land on
 * the app's own origin. Without it the first APP_ORIGINS entry is used.
 */
export function readOAuthConfig(
  env: Pick<ServerEnv, 'APP_ORIGINS'>,
  source: Record<string, string | undefined> = process.env,
): OAuthConfig {
  let redirectBase: string | undefined = env.APP_ORIGINS[0]
  const configured = nonEmpty(source.OAUTH_REDIRECT_BASE)
  if (configured) {
    let origin: string
    try {
      origin = new URL(configured).origin
    } catch {
      throw new OAuthError('unavailable', 'OAUTH_REDIRECT_BASE is not a URL')
    }
    if (!env.APP_ORIGINS.includes(origin)) throw new OAuthError('unavailable', 'OAUTH_REDIRECT_BASE must be one of APP_ORIGINS')
    redirectBase = origin
  }
  if (!redirectBase) throw new OAuthError('unavailable', 'No redirect base')

  const clientId = nonEmpty(source.GOOGLE_CLIENT_ID)
  const clientSecret = nonEmpty(source.GOOGLE_CLIENT_SECRET)
  return { redirectBase, google: clientId && clientSecret ? { clientId, clientSecret } : null }
}

export function callbackUrl(redirectBase: string, providerId: ProviderId): string {
  return `${redirectBase}/api/auth/oauth/${providerId}/callback`
}

export type ProviderDeps = { google?: GoogleDeps }

/** The configured provider, or an `unavailable` error if its keys are missing. */
export function providerFor(id: ProviderId, config: OAuthConfig, deps: ProviderDeps = {}): OAuthProvider {
  switch (id) {
    case 'google':
      if (!config.google) throw new OAuthError('unavailable', 'Google sign-in is not configured')
      return googleProvider(config.google, deps.google)
  }
}
