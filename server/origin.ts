// CSRF defence in depth (on top of SameSite=Lax cookies): state-changing requests must come from
// one of our own origins. Browsers always send Origin on cross-site and on same-site POSTs.
import type { IncomingMessage } from 'node:http'
import { AppError } from './errors.js'
import { header } from './http.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isSafeMethod(method: string | undefined): boolean {
  return SAFE_METHODS.has((method ?? 'GET').toUpperCase())
}

export function assertAllowedOrigin(req: IncomingMessage, allowedOrigins: readonly string[]): void {
  if (isSafeMethod(req.method)) return
  const origin = header(req, 'origin')
  if (!origin || origin === 'null') throw new AppError('origin_rejected', 'Missing Origin header')

  let normalized: string
  try {
    normalized = new URL(origin).origin
  } catch {
    throw new AppError('origin_rejected', 'Malformed Origin header')
  }
  if (!allowedOrigins.includes(normalized)) throw new AppError('origin_rejected', 'Origin not allowed')
}
