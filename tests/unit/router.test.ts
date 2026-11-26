import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetEnvForTests } from '../../server/env.js'
import type { ApiRequest, ApiResponse } from '../../server/http.js'
import { LIMITS } from '../../server/limits.js'
import { captureLogs } from '../../server/log.js'
import { MemoryRateLimiter, type RateLimiter } from '../../server/rateLimit.js'
import { createHandler, type Route } from '../../server/router.js'
import { routes as realRoutes } from '../../server/routes/index.js'

const ALLOWED_ORIGIN = 'http://localhost:5173'
const FAKE_SECRET = 'sk-live-THIS-MUST-NEVER-REACH-THE-CLIENT'

const TEST_ENV: Record<string, string> = {
  FIREBASE_PROJECT_ID: 'demo-bullbir',
  APP_ORIGINS: ALLOWED_ORIGIN,
  AUTH_PEPPER: Buffer.alloc(32, 9).toString('base64'),
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
}
const ENV_KEYS = [...Object.keys(TEST_ENV), 'VERCEL_ENV', 'FIREBASE_SERVICE_ACCOUNT_BASE64', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']

type FakeRes = {
  statusCode: number
  headers: Record<string, string>
  body: string
  ended: boolean
}

function fakeReq(method: string, url: string, headers: Record<string, string> = {}): ApiRequest {
  // Default client address as the Vercel edge would report it; tests may override or remove it.
  const lower = Object.fromEntries(Object.entries({ 'x-vercel-forwarded-for': '198.51.100.10', ...headers }).map(([k, v]) => [k.toLowerCase(), v]))
  return { method, url, headers: lower, socket: { remoteAddress: '198.51.100.10' } } as unknown as ApiRequest
}

function fakeRes(): FakeRes & ApiResponse {
  const state: FakeRes = { statusCode: 0, headers: {}, body: '', ended: false }
  const res = Object.assign(state, {
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = String(value)
    },
    end(chunk?: string) {
      state.body = chunk ?? ''
      state.ended = true
    },
  })
  return res as unknown as FakeRes & ApiResponse
}

// Fake routes first: they shadow real ones with the same path (login, sessions/:id).
const fakeRoutes: Route[] = [
  { method: 'POST', path: 'echo', handler: async () => ({ status: 201, body: { created: true }, headers: { 'X-Custom': 'yes' } }) },
  { method: 'DELETE', path: 'sessions/:id', handler: async (ctx) => ({ body: { deleted: ctx.params.id } }) },
  { method: 'POST', path: 'login', ipLimits: [{ name: 'test-login', limit: 2, windowSeconds: 600 }], handler: async () => ({ body: { ok: true } }) },
  {
    method: 'POST',
    path: 'boom',
    handler: async () => {
      throw new Error(`database password is ${FAKE_SECRET}`)
    },
  },
  ...realRoutes,
]

let savedEnv: Record<string, string | undefined>
let limiter: MemoryRateLimiter
let restoreLogs: () => void
let logLines: string[]

function handler(limiterOverride?: RateLimiter) {
  return createHandler(fakeRoutes, { limiter: () => limiterOverride ?? limiter })
}

async function call(method: string, url: string, headers: Record<string, string> = {}, limiterOverride?: RateLimiter) {
  const res = fakeRes()
  await handler(limiterOverride)(fakeReq(method, url, headers), res)
  return { res, json: JSON.parse(res.body) as Record<string, unknown> }
}

function errorOf(json: Record<string, unknown>) {
  return json.error as { code: string; message: string; requestId: string }
}

beforeAll(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
})

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  resetEnvForTests()
})

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, TEST_ENV)
  // Behave as on Vercel, where the edge sets x-vercel-forwarded-for (clients cannot spoof it).
  process.env.VERCEL = '1'
  resetEnvForTests()
  limiter = new MemoryRateLimiter()
  logLines = []
  restoreLogs = captureLogs((line) => logLines.push(line))
})

afterEach(() => {
  restoreLogs()
  delete process.env.VERCEL
})

describe('createHandler', () => {
  it('GET /api/auth/health → 200 {ok:true} with no-store and a request id', async () => {
    const { res, json } = await call('GET', '/api/auth/health')
    expect(res.statusCode).toBe(200)
    expect(json).toEqual({ ok: true })
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('tolerates a trailing slash and query string', async () => {
    const { res } = await call('GET', '/api/auth/health/?x=1')
    expect(res.statusCode).toBe(200)
  })

  it('returns a new request id for every request', async () => {
    const a = await call('GET', '/api/auth/health')
    const b = await call('GET', '/api/auth/health')
    expect(a.res.headers['x-request-id']).not.toBe(b.res.headers['x-request-id'])
  })

  it.each(['/api/auth/nope', '/api/auth/', '/elsewhere', '/api/auth/health/extra'])('unknown path %s → 404', async (url) => {
    const { res, json } = await call('GET', url)
    expect(res.statusCode).toBe(404)
    const error = errorOf(json)
    expect(error.code).toBe('not_found')
    expect(typeof error.message).toBe('string')
    expect(error.requestId).toBe(res.headers['x-request-id'])
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('wrong method on a known path → 405', async () => {
    const { res, json } = await call('POST', '/api/auth/health', { origin: ALLOWED_ORIGIN })
    expect(res.statusCode).toBe(405)
    expect(errorOf(json).code).toBe('method_not_allowed')
  })

  it('answers 503 when a handler hangs (e.g. database unreachable) instead of waiting forever', async () => {
    const hang: Route = { method: 'GET', path: 'hang', handler: () => new Promise(() => {}) }
    const res = fakeRes()
    const started = Date.now()
    await createHandler([hang], { limiter: () => limiter, timeoutMs: 50 })(fakeReq('GET', '/api/auth/hang'), res)
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).error.code).toBe('service_unavailable')
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('serves Vercel-rewritten requests (/api/auth-router?__path=a/b) like /api/auth/a/b', async () => {
    const nested = await call('DELETE', '/api/auth-router?__path=sessions/abc', { origin: ALLOWED_ORIGIN })
    expect(nested.res.statusCode).toBe(200)
    expect(nested.json).toEqual({ deleted: 'abc' })
    const single = await call('GET', '/api/auth-router?__path=health&x=1')
    expect(single.res.statusCode).toBe(200)
    const missing = await call('GET', '/api/auth-router')
    expect(missing.res.statusCode).toBe(404)
  })

  it('405 lists the allowed methods in an Allow header', async () => {
    const { res } = await call('POST', '/api/auth/health', { origin: ALLOWED_ORIGIN })
    expect(res.headers.allow).toBe('GET')
  })

  it('HEAD is answered by the GET route', async () => {
    const { res } = await call('HEAD', '/api/auth/health')
    expect(res.statusCode).toBe(200)
  })

  it('a malformed percent-escape is a 400, not a 500', async () => {
    const { res, json } = await call('DELETE', '/api/auth/sessions/%E0%A4%A', { origin: ALLOWED_ORIGIN })
    expect(res.statusCode).toBe(400)
    expect(errorOf(json).code).toBe('bad_request')
    expect(logLines.some((l) => l.includes('unhandled error'))).toBe(false)
  })

  it('rejects requests whose client address is unknown instead of sharing one bucket', async () => {
    const { res, json } = await call('GET', '/api/auth/health', { 'x-vercel-forwarded-for': '' })
    expect(res.statusCode).toBe(400)
    expect(errorOf(json).code).toBe('bad_request')
  })

  it('IPv6 clients share one limit per /64', async () => {
    const tight = new MemoryRateLimiter()
    const h = (ip: string) => ({ origin: ALLOWED_ORIGIN, 'x-vercel-forwarded-for': ip })
    expect((await call('POST', '/api/auth/login', h('2001:db8:1:2::1'), tight)).res.statusCode).toBe(200)
    expect((await call('POST', '/api/auth/login', h('2001:db8:1:2::2'), tight)).res.statusCode).toBe(200)
    expect((await call('POST', '/api/auth/login', h('2001:db8:1:2::3'), tight)).res.statusCode).toBe(429)
  })

  it('does not write a second response when the handler already ended it', async () => {
    const res = fakeRes()
    Object.assign(res, { headersSent: true })
    await handler()(fakeReq('GET', '/api/auth/health'), res)
    expect(res.ended).toBe(false)
  })

  it('POST from an allowed origin reaches the handler (status + custom headers)', async () => {
    const { res, json } = await call('POST', '/api/auth/echo', { origin: ALLOWED_ORIGIN })
    expect(res.statusCode).toBe(201)
    expect(json).toEqual({ created: true })
    expect(res.headers['x-custom']).toBe('yes')
    expect(res.headers['x-request-id']).toBeTruthy()
  })

  it('passes decoded path params to the handler', async () => {
    const { res, json } = await call('DELETE', '/api/auth/sessions/abc%20123', { origin: ALLOWED_ORIGIN })
    expect(res.statusCode).toBe(200)
    expect(json).toEqual({ deleted: 'abc 123' })
  })

  it.each([
    ['foreign origin', { origin: 'https://evil.example' }],
    ['no origin', {}],
    ['null origin', { origin: 'null' }],
  ])('POST with %s → 403 origin_rejected', async (_label, headers: Record<string, string>) => {
    const { res, json } = await call('POST', '/api/auth/echo', headers)
    expect(res.statusCode).toBe(403)
    expect(errorOf(json).code).toBe('origin_rejected')
  })

  it('DELETE from a foreign origin → 403 and the handler does not run', async () => {
    const { res, json } = await call('DELETE', '/api/auth/sessions/s1', { origin: 'https://evil.example' })
    expect(res.statusCode).toBe(403)
    expect(json).not.toHaveProperty('deleted')
  })

  it('route ipLimits → 429 with Retry-After', async () => {
    const headers = { origin: ALLOWED_ORIGIN, 'x-vercel-forwarded-for': '203.0.113.5' }
    expect((await call('POST', '/api/auth/login', headers)).res.statusCode).toBe(200)
    expect((await call('POST', '/api/auth/login', headers)).res.statusCode).toBe(200)
    const { res, json } = await call('POST', '/api/auth/login', headers)
    expect(res.statusCode).toBe(429)
    expect(errorOf(json).code).toBe('rate_limited')
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(res.body).not.toContain('test-login')

    // A different IP is not affected.
    const other = await call('POST', '/api/auth/login', { origin: ALLOWED_ORIGIN, 'x-vercel-forwarded-for': '203.0.113.99' })
    expect(other.res.statusCode).toBe(200)
  })

  it('the global per-IP ceiling applies to every route', async () => {
    const headers = { 'x-vercel-forwarded-for': '192.0.2.1' }
    for (let i = 0; i < LIMITS.apiPerIp.limit; i++) await call('GET', '/api/auth/health', headers)
    const { res, json } = await call('GET', '/api/auth/health', headers)
    expect(res.statusCode).toBe(429)
    expect(errorOf(json).code).toBe('rate_limited')
    expect(res.headers['retry-after']).toBeDefined()
  })

  it('a plain Error becomes 500 internal without leaking its message', async () => {
    const { res, json } = await call('POST', '/api/auth/boom', { origin: ALLOWED_ORIGIN })
    expect(res.statusCode).toBe(500)
    expect(errorOf(json).code).toBe('internal')
    expect(res.body).not.toContain(FAKE_SECRET)
    expect(res.body).not.toContain('database password')
    expect(res.headers['x-request-id']).toBeTruthy()
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('fails closed with 503 when the limiter is down', async () => {
    const broken: RateLimiter = { hit: async () => { throw new Error('redis down') } }
    const { res, json } = await call('GET', '/api/auth/health', {}, broken)
    expect(res.statusCode).toBe(503)
    expect(errorOf(json).code).toBe('service_unavailable')
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1)
  })

  it('returns 500 internal (not a crash) when the env is invalid, without leaking it', async () => {
    process.env.AUTH_PEPPER = 'c2hvcnQ=' // "short"
    resetEnvForTests()
    const { res, json } = await call('GET', '/api/auth/health')
    expect(res.statusCode).toBe(500)
    expect(errorOf(json).code).toBe('internal')
    expect(res.body).not.toContain('AUTH_PEPPER')
  })

  it('logs one request line with an IP prefix and no full IP', async () => {
    await call('GET', '/api/auth/health', { 'x-vercel-forwarded-for': '203.0.113.77' })
    const entries = logLines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.msg === 'request')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ method: 'GET', path: 'health', status: 200, ip: '203.0.113.0' })
    expect(logLines.join('\n')).not.toContain('203.0.113.77')
  })

  it('logs unhandled errors server-side with the same request id', async () => {
    const { res } = await call('POST', '/api/auth/boom', { origin: ALLOWED_ORIGIN })
    const entry = logLines.map((l) => JSON.parse(l) as Record<string, unknown>).find((e) => e.msg === 'unhandled error')
    expect(entry).toBeDefined()
    expect(entry?.level).toBe('error')
    expect(entry?.requestId).toBe(res.headers['x-request-id'])
  })
})
