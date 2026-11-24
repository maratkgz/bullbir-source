// Small crypto toolbox. Nothing secret is ever stored or compared in plain form:
//   session tokens → SHA-256, one-time codes → HMAC-SHA-256 with the server pepper,
//   comparisons → constant time.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/** 32 random bytes, URL-safe — used for session tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Random hex id (not a secret by itself), e.g. a session's public id. */
export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('hex')
}

/** Firebase-compatible uid: 28 chars of [A-Za-z0-9]. */
export function newUid(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let uid = ''
  for (let i = 0; i < 28; i++) uid += alphabet[randomInt(alphabet.length)]
  return uid
}

/** 6-digit numeric code, uniformly random (no modulo bias). */
export function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function hmacHex(pepperBase64: string, value: string): string {
  return createHmac('sha256', Buffer.from(pepperBase64, 'base64')).update(value, 'utf8').digest('hex')
}

/** Constant-time comparison of two hex strings (false if lengths differ). */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ab.length !== bb.length || ab.length === 0) return false
  return timingSafeEqual(ab, bb)
}
