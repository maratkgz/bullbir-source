// Browser binding for emailed 8-digit codes (login, reset, email change). The request sets a
// random value in the HttpOnly `__Host-otp` cookie; the code document is keyed by its SHA-256, so
// the code works only together with that browser's cookie (see server/auth/otp.ts).
import type { IncomingMessage } from 'node:http'
import { AppError } from '../errors.js'
import { clearOtpCookie, otpCookie, readOtpChallenge } from './cookies.js'
import { randomToken, sha256Hex } from './crypto.js'
import { CODE_TTL_MS } from './otp.js'
import { now } from './time.js'

export const EMAIL_CODE_DIGITS = 8

export type Challenge = { hash: string; setCookie: string }

export function newChallenge(): Challenge {
  const raw = randomToken()
  return { hash: sha256Hex(raw), setCookie: otpCookie(raw, Math.floor(CODE_TTL_MS / 1000)) }
}

/** SHA-256 of the presented challenge, or `invalid_code` (same answer as a wrong code). */
export function requireChallenge(req: IncomingMessage): string {
  const raw = readOtpChallenge(req)
  if (!raw) throw new AppError('invalid_code', 'Invalid or expired code')
  return sha256Hex(raw)
}

export { clearOtpCookie }

/** "2026-11-25 06:42 UTC" — shown in security mails. */
export function mailTimestamp(): string {
  return `${new Date(now()).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
