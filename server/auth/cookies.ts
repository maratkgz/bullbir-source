// Session cookie. `__Host-` prefix: the browser only accepts it with Secure, Path=/ and no
// Domain, so a subdomain can never set or overwrite it. HttpOnly keeps it out of JavaScript.
import type { IncomingMessage } from 'node:http'
import { header } from '../http.js'

export const SESSION_COOKIE = '__Host-session'
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/ // 32 bytes base64url

export function readSessionToken(req: IncomingMessage): string | undefined {
  const raw = header(req, 'cookie')
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue
    const value = part.slice(eq + 1).trim()
    return TOKEN_SHAPE.test(value) ? value : undefined
  }
  return undefined
}

/** Reads any cookie by name (first match). */
export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const raw = header(req, 'cookie')
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/** Binds an email-code sign-in to this browser (see server/auth/otp.ts). Strict: same-site only. */
export const OTP_COOKIE = '__Host-otp'

export function readOtpChallenge(req: IncomingMessage): string | undefined {
  const value = readCookie(req, OTP_COOKIE)
  return value && TOKEN_SHAPE.test(value) ? value : undefined
}

export function otpCookie(value: string, maxAgeSeconds: number): string {
  return `${OTP_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`
}

export function clearOtpCookie(): string {
  return `${OTP_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
