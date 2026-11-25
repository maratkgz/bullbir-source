// Per-account brute-force lock for password logins:
//   5 attempts without success → locked 15 min; every next lock doubles, up to 24 h; a success
//   resets it. Each attempt is RESERVED in a transaction before the password is checked, so
//   parallel requests cannot squeeze in more than 5 guesses per lock window.
// Kept for EVERY address tried (also non-existent ones), so the lock does not reveal whether an
// account exists. Email-code sign-in (stage 4) is the owner's way in while locked.
//   auth_throttle/{emailKey} → { failures, level, lockedUntil, updatedAt, expiresAt (TTL) }
import { adminDb } from '../firebaseAdmin.js'
import { AppError } from '../errors.js'
import { DAY_MS, MINUTE_MS, now, toMs } from './time.js'

export const THROTTLE = 'auth_throttle'
export const MAX_FAILURES = 5
const BASE_LOCK_MS = 15 * MINUTE_MS
const MAX_LOCK_MS = DAY_MS
/** Forget a quiet address after this long (also the TTL). */
const RETAIN_MS = 2 * DAY_MS

export function lockDurationMs(level: number): number {
  return Math.min(BASE_LOCK_MS * 2 ** Math.max(0, level - 1), MAX_LOCK_MS)
}

function lockedError(untilMs: number): AppError {
  return new AppError('rate_limited', 'Too many attempts', {
    retryAfter: Math.max(1, Math.ceil((untilMs - now()) / 1000)),
  })
}

/**
 * Counts one attempt up front. Throws `rate_limited` if the address is locked. Returns the lock
 * error to use if THIS attempt fails and has just triggered a lock (null otherwise).
 */
export async function reserveAttempt(key: string): Promise<AppError | null> {
  const db = adminDb()
  const ref = db.collection(THROTTLE).doc(key)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const t = now()
    const until = toMs(snap.get('lockedUntil')) ?? 0
    if (until > t) throw lockedError(until)

    const stale = t - (toMs(snap.get('updatedAt')) ?? 0) > RETAIN_MS
    const failures = (stale ? 0 : Number(snap.get('failures') ?? 0)) + 1
    const level = stale ? 0 : Number(snap.get('level') ?? 0)
    const base = { updatedAt: new Date(t), expiresAt: new Date(t + RETAIN_MS) }
    if (failures >= MAX_FAILURES) {
      const lockUntil = t + lockDurationMs(level + 1)
      tx.set(ref, { ...base, failures: 0, level: level + 1, lockedUntil: new Date(lockUntil) })
      return lockedError(lockUntil)
    }
    tx.set(ref, { ...base, failures, level, lockedUntil: null })
    return null
  })
}

/**
 * The owner proved the mailbox (code login): lift the current lock and failures, but KEEP the
 * escalation level, so an attacker still guessing the password keeps hitting doubling locks.
 */
export async function liftLock(key: string): Promise<void> {
  const ref = adminDb().collection(THROTTLE).doc(key)
  const snap = await ref.get()
  if (snap.exists) await ref.update({ failures: 0, lockedUntil: null })
}

/** A successful login: forget the attempts (also lifts a lock this very attempt set). */
export async function clearFailures(key: string): Promise<void> {
  await adminDb().collection(THROTTLE).doc(key).delete()
}
