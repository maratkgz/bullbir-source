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

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
