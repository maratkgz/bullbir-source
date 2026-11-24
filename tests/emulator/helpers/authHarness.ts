// Shared harness for auth emulator tests: env setup, a fresh handler + limiter per test, fake
// req/res, cookie jar helpers, captured mail, an injectable clock, and emulator resets.
// Only ever talks to the "demo-bullbir" emulators.
import type { AuthMail } from '../../../server/auth/mailer.js'
import type { ApiRequest, ApiResponse } from '../../../server/http.js'

export const PROJECT_ID = 'demo-bullbir'
export const ORIGIN = 'http://localhost:5173'
export const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST
export const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST
export const EMULATORS_RUNNING = Boolean(AUTH_HOST && FIRESTORE_HOST)

export const TEST_ENV: Record<string, string> = {
  FIREBASE_PROJECT_ID: PROJECT_ID,
  APP_ORIGINS: ORIGIN,
  AUTH_PEPPER: Buffer.alloc(32, 7).toString('base64'),
}

export const UA_CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
export const UA_FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0'

export type FakeResponse = {
  status: number
  headers: Record<string, string | string[]>
  text: string
  json: Record<string, unknown>
  /** Raw Set-Cookie value (single cookie in this API), if any. */
  setCookie: string | undefined
  /** The session token set by this response; '' when the response clears it. */
  sessionToken: string | undefined
}

function fakeRes(): ApiResponse & { _state: { status: number; headers: Record<string, string | string[]>; body: string } } {
  const state = { status: 0, headers: {} as Record<string, string | string[]>, body: '' }
  const res = {
    _state: state,
    headersSent: false,
    writableEnded: false,
    get statusCode() { return state.status },
    set statusCode(v: number) { state.status = v },
    setHeader(name: string, value: string | string[]) { state.headers[name.toLowerCase()] = value },
    end(chunk?: string) { state.body = chunk ?? ''; res.writableEnded = true },
    destroy() { res.writableEnded = true },
  }
  return res as unknown as ApiResponse & { _state: typeof state }
}

let ipCounter = 0
/** A distinct private IPv4 per call, so per-IP limits never interfere by accident. */
export function nextIp(): string {
  ipCounter += 1
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`
}

export type CallOptions = {
  body?: unknown
  cookie?: string | undefined
  origin?: string | null
  ip?: string
  userAgent?: string
}

export type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>

export async function call(handler: Handler, method: string, path: string, opts: CallOptions = {}): Promise<FakeResponse> {
  const headers: Record<string, string> = {
    'x-vercel-forwarded-for': opts.ip ?? nextIp(),
    'user-agent': opts.userAgent ?? UA_CHROME_WIN,
  }
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN
  if (opts.cookie) headers.cookie = `__Host-session=${opts.cookie}`
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const req = { method, url: `/api/auth/${path}`, headers, body: opts.body, socket: { remoteAddress: '127.0.0.1' } } as unknown as ApiRequest
  const res = fakeRes()
  await handler(req, res)
  const s = res._state
  const raw = s.headers['set-cookie']
  const setCookie = Array.isArray(raw) ? raw[0] : raw
  const m = setCookie ? /^__Host-session=([^;]*)/.exec(setCookie) : null
  return {
    status: s.status,
    headers: s.headers,
    text: s.body,
    json: s.body ? (JSON.parse(s.body) as Record<string, unknown>) : {},
    setCookie,
    sessionToken: m ? m[1] : undefined,
  }
}

export function errorCode(r: FakeResponse): string | undefined {
  return (r.json.error as { code?: string } | undefined)?.code
}

/** Error body without the per-request id — for "identical answer" comparisons. */
export function stableBody(r: FakeResponse): unknown {
  const err = r.json.error as Record<string, unknown> | undefined
  if (!err) return r.json
  const { requestId: _ignored, ...rest } = err
  return { error: rest }
}

export class MailBox {
  readonly sent: AuthMail[] = []
  send = async (mail: AuthMail): Promise<void> => { this.sent.push(mail) }
  codesFor(email: string): string[] {
    return this.sent.flatMap((m) => (m.kind === 'verify-code' && m.to === email ? [m.code] : []))
  }
  lastCode(email: string): string {
    const codes = this.codesFor(email)
    const code = codes[codes.length - 1]
    if (!code) throw new Error(`no code mailed to ${email}`)
    return code
  }
  kindsFor(email: string): string[] {
    return this.sent.filter((m) => m.to === email).map((m) => m.kind)
  }
}

/** A different valid 6-digit code. */
export function otherCode(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, '0')
}

export async function resetEmulators(): Promise<void> {
  const fs = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  if (!fs.ok) throw new Error(`firestore reset failed: ${fs.status}`)
  const auth = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' })
  if (!auth.ok) throw new Error(`auth reset failed: ${auth.status}`)
}

/** Decodes a JWT payload without verifying (test inspection only). */
export function jwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? ''
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
}
