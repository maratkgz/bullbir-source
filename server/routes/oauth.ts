// Sign-in with an OAuth/OIDC provider (Google now, Apple later — same two routes):
//   GET oauth/:provider/start    → 302 to the provider, sets the sealed `__Host-oauth` flow cookie
//   GET oauth/:provider/callback → checks state (cookie), exchanges code (+PKCE), verifies the ID
//                                  token (+nonce), links/creates the account, starts a session,
//                                  302 to /app — or 302 to /login?error=oauth_… on any failure.
// Both are top-level browser navigations, so failures redirect instead of returning JSON.
// GET skips the router's Origin check; the callback is protected by state bound to the cookie.
import { LIMITS } from '../limits.js'
import { deviceLabel } from '../auth/device.js'
import { mailer } from '../auth/mailer.js'
import { log } from '../log.js'
import type { RequestContext, Route, RouteResult } from '../router.js'
import type { LimitRule } from '../rateLimit.js'
import { createSession, deleteSessionByToken } from '../auth/sessions.js'
import { now } from '../auth/time.js'
import { getUser, recordLogin } from '../auth/users.js'
import { resolveOAuthAccount, type ResolvedAccount } from '../auth/oauth/accounts.js'
import { callbackUrl, isKnownProvider, providerFor, readOAuthConfig, type ProviderDeps } from '../auth/oauth/config.js'
import { assertCallbackMatches, clearFlowCookie, flowCookie, newFlow, openFlow, pkceChallenge, readFlowCookie, sealFlow } from '../auth/oauth/flow.js'
import { isOAuthError, OAuthError, type OAuthFailure, type OAuthIdentity } from '../auth/oauth/provider.js'
import { AppError } from '../errors.js'

export const OAUTH_START_LIMIT: LimitRule = LIMITS.oauthStartPerIp
export const OAUTH_CALLBACK_LIMIT: LimitRule = LIMITS.oauthCallbackPerIp

const SUCCESS_PATH = '/app'
const MAX_PARAM_LENGTH = 2048

/** What the login page shows. Token/state/exchange problems share one code on purpose. */
const ERROR_CODES: Record<OAuthFailure, string> = {
  cancelled: 'oauth_cancelled',
  invalid_state: 'oauth_failed',
  provider_error: 'oauth_failed',
  invalid_token: 'oauth_failed',
  email_missing: 'oauth_email_missing',
  email_unverified: 'oauth_email_unverified',
  link_unverified: 'oauth_link_unverified',
  account_exists: 'oauth_account_exists',
  unavailable: 'oauth_unavailable',
}

export type OAuthRouteDeps = {
  source?: Record<string, string | undefined>
  providers?: ProviderDeps
  resolveAccount?: (identity: OAuthIdentity) => Promise<ResolvedAccount>
  /** Returns the Set-Cookie value of the new session. */
  startSession?: (uid: string, ctx: RequestContext) => Promise<string>
  now?: () => number
}

async function defaultStartSession(uid: string, ctx: RequestContext): Promise<string> {
  const user = await getUser(uid)
  // Same rule as password and code login: disabled accounts never get a session.
  if (!user || user.status !== 'active') throw new OAuthError('invalid_state', 'Account missing or disabled')
  // Same as every login: drop any session the browser presented, then issue a fresh token.
  await deleteSessionByToken(ctx.req)
  await recordLogin(uid)
  return createSession(uid, ctx.req, ctx.ipPrefix)
}

/**
 * 302 with Location. NOTE: the router currently always sends a JSON body; browsers ignore it on a
 * redirect, so `body: null` works today (see integration notes for a cleaner router change).
 */
function redirect(location: string, cookies: string[]): RouteResult {
  return {
    status: 302,
    body: null,
    headers: { Location: location, 'Set-Cookie': cookies, 'Referrer-Policy': 'no-referrer' },
  }
}

function loginError(reason: OAuthFailure): string {
  return `/login?error=${ERROR_CODES[reason]}`
}

function queryOf(url: string | undefined): URLSearchParams {
  return new URL(url ?? '/', 'http://localhost').searchParams
}

function param(q: URLSearchParams, name: string): string | null {
  const v = q.get(name)
  return v && v.length <= MAX_PARAM_LENGTH ? v : null
}

function knownProvider(ctx: RequestContext) {
  const id = ctx.params.provider ?? ''
  // Unknown provider = unknown URL: plain 404 like any other path.
  if (!isKnownProvider(id)) throw new AppError('not_found')
  return id
}

function logFailure(ctx: RequestContext, err: unknown, step: string): OAuthFailure {
  if (isOAuthError(err)) {
    log.info('oauth rejected', { requestId: ctx.requestId, step, reason: err.reason, detail: err.message })
    return err.reason
  }
  log.error('oauth failed', { requestId: ctx.requestId, step, err })
  return 'provider_error'
}

export function createOAuthRoutes(deps: OAuthRouteDeps = {}): { start: Route; callback: Route } {
  const clock = deps.now ?? now
  const resolveAccount = deps.resolveAccount ?? resolveOAuthAccount
  const startSession = deps.startSession ?? defaultStartSession

  const start: Route = {
    method: 'GET',
    path: 'oauth/:provider/start',
    noHead: true,
    ipLimits: [OAUTH_START_LIMIT],
    async handler(ctx) {
      const id = knownProvider(ctx)
      try {
        const config = readOAuthConfig(ctx.env, deps.source)
        const provider = providerFor(id, config, deps.providers)
        const flow = newFlow(id, clock())
        const location = provider.authorizeUrl({
          state: flow.state,
          nonce: flow.nonce,
          codeChallenge: pkceChallenge(flow.codeVerifier),
          redirectUri: callbackUrl(config.redirectBase, id),
        })
        return redirect(location, [flowCookie(sealFlow(flow, ctx.env.AUTH_PEPPER))])
      } catch (err) {
        return redirect(loginError(logFailure(ctx, err, 'start')), [clearFlowCookie()])
      }
    },
  }

  const callback: Route = {
    method: 'GET',
    path: 'oauth/:provider/callback',
    noHead: true,
    ipLimits: [OAUTH_CALLBACK_LIMIT],
    async handler(ctx) {
      const id = knownProvider(ctx)
      // The flow cookie is single-use: cleared on every outcome.
      const clear = clearFlowCookie()
      try {
        const q = queryOf(ctx.req.url)
        if (q.has('error')) throw new OAuthError('cancelled', 'Provider returned an error')

        const flow = openFlow(readFlowCookie(ctx.req), ctx.env.AUTH_PEPPER, clock())
        assertCallbackMatches(flow, { provider: id, state: param(q, 'state') })
        const code = param(q, 'code')
        if (!code) throw new OAuthError('invalid_state', 'Missing code')

        const config = readOAuthConfig(ctx.env, deps.source)
        const provider = providerFor(id, config, deps.providers)
        const { idToken } = await provider.exchange({
          code,
          codeVerifier: flow.codeVerifier,
          redirectUri: callbackUrl(config.redirectBase, id),
        })
        const identity = await provider.verifyIdToken(idToken, { nonce: flow.nonce })
        const account = await resolveAccount(identity)
        const session = await startSession(account.uid, ctx)
        // Only when an EXISTING account gained a new way in — not for a brand-new signup.
        if (account.linked && !account.created) await notifyLinked(ctx, identity.email, id)
        log.info('oauth sign-in', { requestId: ctx.requestId, provider: id, created: account.created, linked: account.linked })
        return redirect(SUCCESS_PATH, [clear, session])
      } catch (err) {
        return redirect(loginError(logFailure(ctx, err, 'callback')), [clear])
      }
    },
  }

  return { start, callback }
}

/** Tell the owner a new sign-in method was added; a mail failure must not block the sign-in. */
async function notifyLinked(ctx: RequestContext, email: string, providerId: string): Promise<void> {
  try {
    await mailer().send({
      kind: 'provider-linked',
      to: email,
      provider: providerId === 'google' ? 'Google' : providerId,
      device: deviceLabel(ctx.req),
      at: new Date(now()).toISOString().slice(0, 16).replace('T', ' '),
    })
  } catch (err) {
    log.error('link notice mail failed', { requestId: ctx.requestId, err })
  }
}

const defaults = createOAuthRoutes()
export const oauthStart = defaults.start
export const oauthCallback = defaults.callback
