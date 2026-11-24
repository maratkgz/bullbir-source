// Password policy and hashing.
//  - argon2id, OWASP parameters (m=19 MiB, t=2, p=1) — ~25 ms locally, fine for serverless.
//  - Length 10–128 (NIST 800-63B: length over composition rules) + "known breached" check via
//    Have I Been Pwned k-anonymity: only the first 5 hex chars of SHA-1 leave the server.
//  - verifyPasswordOrDummy() spends the same time when the account does not exist, so response
//    time does not reveal which emails are registered.
import { createHash } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import { AppError } from '../errors.js'
import { log } from '../log.js'
import { randomToken } from './crypto.js'

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 128

const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2)
}

// Hash of a random throwaway password, computed once per instance, used only to burn the same
// amount of CPU when there is no real hash to check.
let dummyHash: Promise<string> | undefined
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomToken())
  return dummyHash
}

/** Verifies against `stored`, or against a dummy hash when there is none. */
export async function verifyPasswordOrDummy(stored: string | null | undefined, password: string): Promise<boolean> {
  if (!stored) {
    await verify(await getDummyHash(), password).catch(() => false)
    return false
  }
  try {
    return await verify(stored, password)
  } catch (err) {
    log.error('password hash unreadable', { err })
    return false
  }
}

/** Length rules only (cheap, run before any expensive work). */
export function assertPasswordLength(password: string): void {
  const length = [...password].length
  if (length < PASSWORD_MIN || length > PASSWORD_MAX) {
    throw new AppError('weak_password', `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`)
  }
}

// ---------------------------------------------------------------- breached-password check

export type BreachChecker = (password: string) => Promise<boolean>

const HIBP_TIMEOUT_MS = 2000

/** True if the password appears in HIBP. Fails OPEN (returns false) when HIBP is unreachable. */
export const hibpChecker: BreachChecker = async (password) => {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
  const prefix = sha1.slice(0, 5)
  const suffix = sha1.slice(5)
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'bullbir-auth/1.0' },
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HIBP status ${res.status}`)
    const body = await res.text()
    return body.split('\n').some((line) => {
      const [s, count] = line.trim().split(':')
      return s === suffix && Number(count) > 0
    })
  } catch (err) {
    // A breach list is a blocklist, not a gate: an outage must not stop registrations.
    log.warn('breached-password check unavailable, allowing', { err })
    return false
  }
}

let checker: BreachChecker = hibpChecker

export function setBreachCheckerForTests(next: BreachChecker | undefined): void {
  checker = next ?? hibpChecker
}

/** Full policy for a NEW password (registration, change, reset). */
export async function assertAcceptablePassword(password: string): Promise<void> {
  assertPasswordLength(password)
  if (await checker(password)) {
    throw new AppError('breached_password', 'Password found in known data breaches')
  }
}
