// Minimal HTTP helpers on top of Node's standard request/response, so the same handler runs on
// Vercel Serverless Functions and inside the Vite dev server.
import { isIP } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { AppError } from './errors.js'

export const MAX_BODY_BYTES = 16 * 1024

export type ApiRequest = IncomingMessage & { body?: unknown }
export type ApiResponse = ServerResponse
/** Response headers; an array value sends the header several times (e.g. Set-Cookie). */
export type HeaderMap = Record<string, string | string[]>

export function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()]
  return Array.isArray(v) ? v[0] : v
}

const JSON_MEDIA_TYPE = /^application\/json\s*(;|$)/i

/** Reads and parses a JSON body (max 16 KB). Works whether or not Vercel already parsed it. */
export async function readJson(req: ApiRequest): Promise<unknown> {
  if (!JSON_MEDIA_TYPE.test(header(req, 'content-type') ?? '')) {
    throw new AppError('unsupported_media_type', 'Content-Type must be application/json')
  }
  const lengthHeader = header(req, 'content-length')
  if (lengthHeader !== undefined) {
    const declared = Number(lengthHeader)
    if (!Number.isSafeInteger(declared) || declared < 0) throw new AppError('bad_request', 'Invalid Content-Length')
    if (declared > MAX_BODY_BYTES) throw new AppError('payload_too_large')
  }

  // Vercel exposes `req.body` as a lazy getter that parses JSON itself and throws on bad input.
  let preParsed: unknown
  try {
    preParsed = req.body
  } catch {
    throw new AppError('bad_request', 'Malformed JSON')
  }
  if (preParsed !== undefined) {
    const text = typeof preParsed === 'string' ? preParsed
      : Buffer.isBuffer(preParsed) ? preParsed.toString('utf8')
      : JSON.stringify(preParsed)
    if (Buffer.byteLength(text ?? '', 'utf8') > MAX_BODY_BYTES) throw new AppError('payload_too_large')
    return parse(text ?? '')
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buf.length
    if (size > MAX_BODY_BYTES) {
      req.destroy()
      throw new AppError('payload_too_large')
    }
    chunks.push(buf)
  }
  return parse(Buffer.concat(chunks).toString('utf8'))
}

function parse(text: string): unknown {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new AppError('bad_request', 'Malformed JSON')
  }
}

function validIp(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v && isIP(v) ? v : undefined
}

/**
 * Client IP for rate limits.
 * - On Vercel (`VERCEL` is set) the edge writes `x-vercel-forwarded-for` / `x-real-ip` itself;
 *   a client cannot spoof them.
 * - Anywhere else forwarding headers are client-controlled, so only the socket address counts.
 * Returns undefined when no valid address is known — callers reject; never one shared bucket.
 */
export function clientIp(req: IncomingMessage, onVercel = Boolean(process.env.VERCEL)): string | undefined {
  if (onVercel) {
    return validIp(header(req, 'x-vercel-forwarded-for')?.split(',')[0]) ?? validIp(header(req, 'x-real-ip'))
  }
  return validIp(req.socket?.remoteAddress)
}

function unmapIpv4(ip: string): string {
  return /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? ip
}

/** Expands an IPv6 address to its 8 groups (handles `::`). */
function ipv6Groups(ip: string): string[] {
  const [head = '', tail = ''] = ip.split('::')
  const h = head ? head.split(':') : []
  const t = ip.includes('::') && tail ? tail.split(':') : []
  const fill = ip.includes('::') ? Array(8 - h.length - t.length).fill('0') : []
  return [...h, ...fill, ...t].map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
}

/**
 * Rate-limit key: the IPv4 address, or the IPv6 /64 (one customer usually owns a whole /64,
 * so per-address keys would let them rotate addresses freely).
 */
export function limitKeyForIp(ip: string): string {
  const v = unmapIpv4(ip)
  if (isIP(v) !== 6) return v
  return `${ipv6Groups(v).slice(0, 4).join(':')}::/64`
}

/** Privacy-friendly IP prefix for logs/events: /24 for IPv4, /48 for IPv6. */
export function ipPrefix(ip: string | undefined): string {
  if (!ip) return 'unknown'
  const v = unmapIpv4(ip)
  const kind = isIP(v)
  if (kind === 4) return v.split('.').slice(0, 3).concat('0').join('.')
  if (kind === 6) return `${ipv6Groups(v).slice(0, 3).join(':')}::/48`
  return 'unknown'
}

export function sendJson(res: ApiResponse, status: number, body: unknown, headers: HeaderMap = {}): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}
