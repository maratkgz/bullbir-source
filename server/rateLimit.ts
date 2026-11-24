// Rate limiting. Production: Upstash Redis (shared by every serverless instance).
// Emulator/tests: an in-memory sliding window with the SAME interface, so limits are testable
// locally instead of being switched off.
// Fail closed: if Redis is unreachable we reject the request rather than silently dropping
// brute-force protection.
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { getEnv } from './env.js'
import { AppError } from './errors.js'
import { log } from './log.js'

const REDIS_TIMEOUT_MS = 1500

export type LimitRule = {
  /** Stable name, appears in Redis keys and logs, never in response bodies. */
  name: string
  limit: number
  windowSeconds: number
}

export type LimitResult = { success: boolean; remaining: number; resetAt: number }

export interface RateLimiter {
  hit(rule: LimitRule, key: string): Promise<LimitResult>
}

/** Sliding-window log kept in process memory. Only for the emulator and tests. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(private readonly now: () => number = Date.now) {}

  async hit(rule: LimitRule, key: string): Promise<LimitResult> {
    const now = this.now()
    const windowMs = rule.windowSeconds * 1000
    const bucket = `${rule.name}:${key}`
    const recent = (this.hits.get(bucket) ?? []).filter((t) => t > now - windowMs)
    if (recent.length >= rule.limit) {
      this.hits.set(bucket, recent)
      return { success: false, remaining: 0, resetAt: (recent[0] ?? now) + windowMs }
    }
    const next = [...recent, now]
    this.hits.set(bucket, next)
    return { success: true, remaining: rule.limit - next.length, resetAt: (next[0] ?? now) + windowMs }
  }
}

export class UpstashRateLimiter implements RateLimiter {
  private readonly limiters = new Map<string, Ratelimit>()

  constructor(private readonly redis: Redis) {}

  private limiterFor(rule: LimitRule): Ratelimit {
    const id = `${rule.name}:${rule.limit}:${rule.windowSeconds}`
    let limiter = this.limiters.get(id)
    if (!limiter) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSeconds} s`),
        prefix: `bb:rl:${rule.name}`,
        analytics: false,
        timeout: REDIS_TIMEOUT_MS,
      })
      this.limiters.set(id, limiter)
    }
    return limiter
  }

  async hit(rule: LimitRule, key: string): Promise<LimitResult> {
    const r = await this.limiterFor(rule).limit(key)
    // On a slow Redis the library answers success with reason "timeout" — that is fail-OPEN.
    // Treat it as an outage so enforceLimit rejects the request.
    if ((r as { reason?: string }).reason === 'timeout') throw new Error('rate limiter timed out')
    return { success: r.success, remaining: r.remaining, resetAt: r.reset }
  }
}

let shared: RateLimiter | undefined

/** The limiter for the current environment (memoised per serverless instance). */
export function rateLimiter(): RateLimiter {
  if (shared) return shared
  const env = getEnv()
  shared =
    env.mode === 'emulator'
      ? new MemoryRateLimiter()
      : new UpstashRateLimiter(new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }))
  return shared
}

/** Test helper: replace (or reset with undefined) the shared limiter. */
export function setRateLimiterForTests(limiter: RateLimiter | undefined): void {
  shared = limiter
}

/** Count one hit; throws `rate_limited` (with Retry-After) when over the limit. */
export async function enforceLimit(rule: LimitRule, key: string, limiter: RateLimiter): Promise<void> {
  let result: LimitResult
  try {
    result = await limiter.hit(rule, key)
  } catch (err) {
    log.error('rate limiter unavailable', { rule: rule.name, err })
    throw new AppError('service_unavailable', 'Service temporarily unavailable', { retryAfter: 30 })
  }
  if (!result.success) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
    throw new AppError('rate_limited', 'Too many attempts', { retryAfter })
  }
}
