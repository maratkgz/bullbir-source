import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '../../server/errors.js'
import { captureLogs } from '../../server/log.js'
import { enforceLimit, MemoryRateLimiter, type LimitRule, type RateLimiter } from '../../server/rateLimit.js'

const RULE: LimitRule = { name: 'test-rule', limit: 3, windowSeconds: 60 }
const OTHER_RULE: LimitRule = { name: 'other-rule', limit: 1, windowSeconds: 60 }

function fakeClock(start = Date.now()) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

async function catchError(p: Promise<unknown>): Promise<AppError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(AppError)
    return err as AppError
  }
  throw new Error('expected rejection')
}

describe('MemoryRateLimiter', () => {
  it('allows `limit` hits, then blocks', async () => {
    const clock = fakeClock()
    const limiter = new MemoryRateLimiter(clock.now)
    const results = []
    for (let i = 0; i < RULE.limit; i++) results.push(await limiter.hit(RULE, 'ip-1'))
    expect(results.map((r) => r.success)).toEqual([true, true, true])
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0])

    const blocked = await limiter.hit(RULE, 'ip-1')
    expect(blocked.success).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.resetAt).toBe(clock.now() + RULE.windowSeconds * 1000)
  })

  it('keeps blocking inside the window and recovers after it', async () => {
    const clock = fakeClock()
    const limiter = new MemoryRateLimiter(clock.now)
    for (let i = 0; i < RULE.limit; i++) await limiter.hit(RULE, 'k')

    clock.advance(59_999)
    expect((await limiter.hit(RULE, 'k')).success).toBe(false)

    clock.advance(1)
    expect((await limiter.hit(RULE, 'k')).success).toBe(true)
  })

  it('is a sliding window: old hits expire one by one', async () => {
    const clock = fakeClock()
    const limiter = new MemoryRateLimiter(clock.now)
    await limiter.hit(RULE, 'k') // t=0
    clock.advance(30_000)
    await limiter.hit(RULE, 'k') // t=30s
    await limiter.hit(RULE, 'k') // t=30s
    expect((await limiter.hit(RULE, 'k')).success).toBe(false)
    clock.advance(30_000) // t=60s: first hit expired
    expect((await limiter.hit(RULE, 'k')).success).toBe(true)
    expect((await limiter.hit(RULE, 'k')).success).toBe(false)
  })

  it('blocked attempts do not extend the window', async () => {
    const clock = fakeClock()
    const limiter = new MemoryRateLimiter(clock.now)
    for (let i = 0; i < RULE.limit; i++) await limiter.hit(RULE, 'k')
    for (let i = 0; i < 10; i++) {
      clock.advance(1000)
      await limiter.hit(RULE, 'k')
    }
    clock.advance(50_000) // 60s after the first allowed hits
    expect((await limiter.hit(RULE, 'k')).success).toBe(true)
  })

  it('keeps separate keys and rules independent', async () => {
    const limiter = new MemoryRateLimiter(fakeClock().now)
    for (let i = 0; i < RULE.limit; i++) await limiter.hit(RULE, 'a')
    expect((await limiter.hit(RULE, 'a')).success).toBe(false)
    expect((await limiter.hit(RULE, 'b')).success).toBe(true)
    expect((await limiter.hit(OTHER_RULE, 'a')).success).toBe(true)
    expect((await limiter.hit(OTHER_RULE, 'a')).success).toBe(false)
    expect((await limiter.hit(RULE, 'b')).success).toBe(true)
  })
})

describe('enforceLimit', () => {
  let restore: (() => void) | undefined
  afterEach(() => restore?.())

  it('passes while under the limit', async () => {
    const limiter = new MemoryRateLimiter()
    for (let i = 0; i < RULE.limit; i++) await expect(enforceLimit(RULE, 'ip', limiter)).resolves.toBeUndefined()
  })

  it('throws rate_limited with retryAfter >= 1 when over the limit', async () => {
    const limiter = new MemoryRateLimiter()
    for (let i = 0; i < RULE.limit; i++) await enforceLimit(RULE, 'ip', limiter)
    const err = await catchError(enforceLimit(RULE, 'ip', limiter))
    expect(err.code).toBe('rate_limited')
    expect(err.status).toBe(429)
    expect(err.retryAfter).toBeGreaterThanOrEqual(1)
    expect(err.retryAfter).toBeLessThanOrEqual(RULE.windowSeconds)
    expect(err.message).not.toContain(RULE.name)
  })

  it('retryAfter is at least 1 even when reset is already in the past', async () => {
    const limiter: RateLimiter = { hit: async () => ({ success: false, remaining: 0, resetAt: 0 }) }
    const err = await catchError(enforceLimit(RULE, 'ip', limiter))
    expect(err.retryAfter).toBe(1)
  })

  it('fails CLOSED with `service_unavailable` (503) when the limiter is unavailable', async () => {
    const lines: string[] = []
    restore = captureLogs((l) => lines.push(l))
    const limiter: RateLimiter = {
      hit: async () => {
        throw new Error('ECONNREFUSED redis token=UPSTASH-SECRET-TOKEN-VALUE-0123456789abcdef')
      },
    }
    const err = await catchError(enforceLimit(RULE, 'ip', limiter))
    expect(err.code).toBe('service_unavailable')
    expect(err.status).toBe(503)
    expect(err.message).not.toContain('ECONNREFUSED')
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('UPSTASH-SECRET-TOKEN-VALUE-0123456789abcdef')
  })
})
