// One pipeline for every auth endpoint, so no route can "forget" a protection:
//   request id → env check → client IP → per-IP flood limit → route match → Origin (CSRF) →
//   route limits → handler → uniform JSON errors → logs without secrets.
import { randomUUID } from 'node:crypto'
import { AppError, isAppError } from './errors.js'
import { getEnv, type ServerEnv } from './env.js'
import { clientIp, ipPrefix, limitKeyForIp, sendJson, type ApiRequest, type ApiResponse, type HeaderMap } from './http.js'
import { LIMITS } from './limits.js'
import { log } from './log.js'
import { assertAllowedOrigin } from './origin.js'
import { enforceLimit, type LimitRule, type RateLimiter, rateLimiter } from './rateLimit.js'

export const API_PREFIX = '/api/auth/'

export type Method = 'GET' | 'POST' | 'DELETE'

export type RequestContext = {
  req: ApiRequest
  env: ServerEnv
  /** Rate-limit key for the client (IPv4 address or IPv6 /64). */
  ipKey: string
  /** Coarse client network for sessions/logs (/24 or /48), never the full address. */
  ipPrefix: string
  /** The limiter in use (for per-account limits inside handlers). */
  limiter: RateLimiter
  requestId: string
  params: Record<string, string>
}

export type RouteResult = {
  status?: number
  body: unknown
  /** Use an array for repeated headers such as Set-Cookie. */
  headers?: HeaderMap
}

export type Route = {
  method: Method
  /** Relative to /api/auth/, e.g. "health" or "sessions/:id". */
  path: string
  /** Extra per-IP limits for this route (the global per-IP ceiling always applies). */
  ipLimits?: readonly LimitRule[]
  handler: (ctx: RequestContext) => Promise<RouteResult>
  /** Don't answer HEAD with this GET route (it has side effects, e.g. the OAuth callback). */
  noHead?: boolean
}

type Match = { route: Route; params: Record<string, string> }

function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg)
  } catch {
    throw new AppError('bad_request', 'Malformed path')
  }
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/')
  const s = path.split('/')
  if (p.length !== s.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    const part = p[i] as string
    const seg = s[i] as string
    if (part.startsWith(':')) {
      if (!seg) return null
      params[part.slice(1)] = decodeSegment(seg)
    } else if (part !== seg) {
      return null
    }
  }
  return params
}

/** HEAD is answered by the GET route (Node drops the body for HEAD). */
function findRoute(routes: readonly Route[], method: string, path: string): Match | { allow: string[] } | null {
  const wanted = method === 'HEAD' ? 'GET' : method
  const allow: string[] = []
  for (const route of routes) {
    const params = matchPath(route.path, path)
    if (!params) continue
    if (route.method === wanted && !(method === 'HEAD' && route.noHead)) return { route, params }
    allow.push(route.method)
  }
  return allow.length ? { allow } : null
}

/** Path below /api/auth/ without query or trailing slashes. Never throws. */
function relativePath(url: string | undefined): string {
  const pathname = (url ?? '/').split('?')[0] ?? '/'
  return pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length).replace(/\/+$/, '') : ''
}

/** Sends unless the response is already on its way; a broken socket must not crash the function. */
function safeSend(res: ApiResponse, status: number, body: unknown, headers: HeaderMap, requestId: string): void {
  if (res.headersSent || res.writableEnded) return
  try {
    if (status >= 300 && status < 400) {
      // Redirects (OAuth): headers only, no JSON body.
      res.statusCode = status
      res.setHeader('Cache-Control', 'no-store')
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
      res.end()
      return
    }
    sendJson(res, status, body, headers)
  } catch (err) {
    log.error('failed to send response', { requestId, err })
    res.destroy()
  }
}

/**
 * Upper bound for one handler. Firestore/Redis retries can otherwise hold a request for ~45 s
 * when a dependency is down; the user gets a clear 503 instead of an endless spinner.
 */
export const HANDLER_TIMEOUT_MS = 8000

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError('service_unavailable', 'Service temporarily unavailable', { retryAfter: 30 })), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

export function createHandler(
  routes: readonly Route[],
  deps: { limiter?: () => RateLimiter; timeoutMs?: number } = {},
) {
  const limiterOf = deps.limiter ?? rateLimiter
  const timeoutMs = deps.timeoutMs ?? HANDLER_TIMEOUT_MS

  return async function handle(req: ApiRequest, res: ApiResponse): Promise<void> {
    const requestId = randomUUID()
    const started = Date.now()
    const method = (req.method ?? 'GET').toUpperCase()
    const path = relativePath(req.url)
    let ip: string | undefined
    let status = 500

    try {
      const env = getEnv()
      ip = clientIp(req)
      if (!ip) throw new AppError('bad_request', 'Client address unknown')
      const ipKey = limitKeyForIp(ip)
      const limiter = limiterOf()
      await enforceLimit(LIMITS.apiPerIp, ipKey, limiter)

      const match = findRoute(routes, method, path)
      if (match === null) throw new AppError('not_found')
      if ('allow' in match) {
        status = 405
        safeSend(res, 405, { error: { code: 'method_not_allowed', message: 'method_not_allowed', requestId } },
          { 'X-Request-Id': requestId, Allow: match.allow.join(', ') }, requestId)
        return
      }

      assertAllowedOrigin(req, env.APP_ORIGINS)
      for (const rule of match.route.ipLimits ?? []) await enforceLimit(rule, ipKey, limiter)

      const result = await withTimeout(
        match.route.handler({ req, env, ipKey, ipPrefix: ipPrefix(ip), limiter, requestId, params: match.params }),
        timeoutMs,
      )
      status = result.status ?? 200
      safeSend(res, status, result.body, { ...result.headers, 'X-Request-Id': requestId }, requestId)
    } catch (err) {
      const safe = isAppError(err) ? err : new AppError('internal', 'Internal error')
      status = safe.status
      if (!isAppError(err)) log.error('unhandled error', { requestId, path, err })
      else if (safe.status >= 500) log.error('request failed', { requestId, path, errorCode: safe.code })
      const headers: HeaderMap = { 'X-Request-Id': requestId }
      if (safe.retryAfter) headers['Retry-After'] = String(safe.retryAfter)
      safeSend(res, safe.status, { error: { code: safe.code, message: safe.message, requestId } }, headers, requestId)
    } finally {
      log.info('request', { requestId, method, path, status, ms: Date.now() - started, ip: ipPrefix(ip) })
    }
  }
}
