// One-time 6-digit codes sent by email.
//   otp_codes/{purpose}_{emailKey} → { purpose, codeHmac, expiresAt, attempts, createdAt, data }
// One live code per purpose and address (a new request replaces the old one). The code itself is
// never stored — only HMAC(pepper, docId:code). A code works once, for 10 minutes, and burns after
// 5 failed attempts. Every failure gives the same answer (`invalid_code`).
//
// `data` carries what the code authorises. For registration it is the PENDING account
// (argon2 hash + name): the account is created only when the mailbox owner enters the code
// together with the same password — so nobody can pre-register someone else's address.
import { adminDb } from '../firebaseAdmin.js'
import { getEnv } from '../env.js'
import { AppError } from '../errors.js'
import { hmacHex, safeEqualHex, sixDigitCode } from './crypto.js'
import { MINUTE_MS, now, toMs } from './time.js'

export const OTP = 'otp_codes'
export const CODE_TTL_MS = 10 * MINUTE_MS
export const MAX_ATTEMPTS = 5

export type OtpPurpose = 'verify' | 'login' | 'reset' | 'change_email'

export type OtpData = {
  uid?: string
  pendingHash?: string
  displayName?: string | null
}

function docId(purpose: OtpPurpose, key: string): string {
  return `${purpose}_${key}`
}

function codeHmac(id: string, code: string): string {
  return hmacHex(getEnv().AUTH_PEPPER, `${id}:${code}`)
}

/** Creates (or replaces) the code and returns it — the caller emails it and forgets it. */
export async function issueCode(purpose: OtpPurpose, key: string, data: OtpData): Promise<string> {
  const id = docId(purpose, key)
  const code = sixDigitCode()
  const t = now()
  await adminDb().collection(OTP).doc(id).set({
    purpose,
    codeHmac: codeHmac(id, code),
    attempts: 0,
    createdAt: new Date(t),
    expiresAt: new Date(t + CODE_TTL_MS),
    data,
  })
  return code
}

/**
 * Checks and consumes a code atomically and returns its data. `extraCheck` (e.g. "the password
 * matches the pending registration") runs only for a correct code; if it fails, it counts as a
 * failed attempt.
 */
export async function consumeCode(
  purpose: OtpPurpose,
  key: string,
  code: string,
  extraCheck?: (data: OtpData) => Promise<boolean>,
): Promise<OtpData> {
  const db = adminDb()
  const id = docId(purpose, key)
  const ref = db.collection(OTP).doc(id)
  const candidate = codeHmac(id, code)

  const data = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const expired = (toMs(snap.get('expiresAt')) ?? 0) <= now()
    const attempts = Number(snap.get('attempts') ?? 0)
    if (expired || attempts >= MAX_ATTEMPTS) {
      tx.delete(ref)
      return null
    }
    const stored = (snap.get('data') ?? {}) as OtpData
    const ok = safeEqualHex(String(snap.get('codeHmac')), candidate)
      && (extraCheck ? await extraCheck(stored) : true)
    if (!ok) {
      if (attempts + 1 >= MAX_ATTEMPTS) tx.delete(ref)
      else tx.update(ref, { attempts: attempts + 1 })
      return null
    }
    tx.delete(ref) // single use
    return stored
  })
  if (!data) throw new AppError('invalid_code', 'Invalid or expired code')
  return data
}
