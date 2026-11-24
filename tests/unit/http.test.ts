import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { AppError } from '../../server/errors.js'
import { clientIp, header, ipPrefix, limitKeyForIp, MAX_BODY_BYTES, readJson, sendJson, type ApiRequest, type ApiResponse } from '../../server/http.js'

type FakeReqInit = {
  headers?: Record<string, string | string[]>
  chunks?: (string | Buffer)[]
  body?: unknown
  remoteAddress?: string
}

function fakeReq({ headers = {}, chunks = [], body, remoteAddress }: FakeReqInit = {}): ApiRequest {
  const stream = Readable.from(chunks) as unknown as ApiRequest
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  Object.assign(stream, { headers: lower, socket: { remoteAddress }, method: 'POST' })
  if (body !== undefined) Object.assign(stream, { body })
  return stream
}

async function catchError(p: Promise<unknown>): Promise<AppError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(AppError)
    return err as AppError
  }
  throw new Error('expected rejection')
}

const JSON_HEADERS = { 'content-type': 'application/json' }

describe('header', () => {
  it('is case-insensitive and takes the first of repeated headers', () => {
    const req = fakeReq({ headers: { 'X-Test': ['a', 'b'] } })
    expect(header(req, 'x-test')).toBe('a')
    expect(header(req, 'X-TEST')).toBe('a')
    expect(header(req, 'missing')).toBeUndefined()
  })
})

describe('clientIp', () => {
  it('off Vercel, ignores client-controlled forwarding headers and uses the socket', () => {
    const req = fakeReq({ headers: { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.8', 'x-vercel-forwarded-for': '203.0.113.9' }, remoteAddress: '10.9.9.9' })
    expect(clientIp(req, false)).toBe('10.9.9.9')
  })

  it('on Vercel, uses the edge-set x-vercel-forwarded-for, then x-real-ip, never x-forwarded-for', () => {
    expect(clientIp(fakeReq({ headers: { 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '1.2.3.4' } }), true)).toBe('203.0.113.9')
    expect(clientIp(fakeReq({ headers: { 'x-real-ip': '203.0.113.8', 'x-forwarded-for': '1.2.3.4' } }), true)).toBe('203.0.113.8')
    expect(clientIp(fakeReq({ headers: { 'x-forwarded-for': '1.2.3.4' }, remoteAddress: '10.9.9.9' }), true)).toBeUndefined()
  })

  it('rejects values that are not IP addresses', () => {
    expect(clientIp(fakeReq({ headers: { 'x-vercel-forwarded-for': 'evil' } }), true)).toBeUndefined()
  })

  it('falls back to the socket address', () => {
    expect(clientIp(fakeReq({ remoteAddress: '198.51.100.4' }))).toBe('198.51.100.4')
    expect(clientIp(fakeReq({ headers: { 'x-forwarded-for': '' }, remoteAddress: '198.51.100.4' }))).toBe('198.51.100.4')
  })

  it('returns undefined (caller rejects) when nothing is available', () => {
    expect(clientIp(fakeReq(), false)).toBeUndefined()
  })
})

describe('ipPrefix', () => {
  it('keeps the /24 of IPv4', () => expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0'))
  it('keeps the /48 of IPv6', () => expect(ipPrefix('2001:db8:abcd:12:34:56:78:9')).toBe('2001:db8:abcd::/48'))
  it('unmaps IPv4-mapped IPv6', () => expect(ipPrefix('::ffff:203.0.113.77')).toBe('203.0.113.0'))
  it('expands compressed IPv6', () => expect(ipPrefix('2001:db8::1')).toBe('2001:db8:0::/48'))
  it('returns "unknown" for anything else', () => {
    expect(ipPrefix('unknown')).toBe('unknown')
    expect(ipPrefix('')).toBe('unknown')
  })
})

describe('readJson', () => {
  it('parses a streamed JSON body', async () => {
    const req = fakeReq({ headers: JSON_HEADERS, chunks: ['{"email":', Buffer.from('"a@b.co"}')] })
    await expect(readJson(req)).resolves.toEqual({ email: 'a@b.co' })
  })

  it('accepts application/json with charset', async () => {
    const req = fakeReq({ headers: { 'content-type': 'Application/JSON; charset=utf-8' }, chunks: ['[1,2]'] })
    await expect(readJson(req)).resolves.toEqual([1, 2])
  })

  it('treats an empty body as {}', async () => {
    await expect(readJson(fakeReq({ headers: JSON_HEADERS, chunks: [] }))).resolves.toEqual({})
  })

  it.each([undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'])(
    'rejects content-type %s with 415',
    async (type) => {
      const headers: Record<string, string> = type ? { 'content-type': type } : {}
      const err = await catchError(readJson(fakeReq({ headers, chunks: ['{}'] })))
      expect(err.code).toBe('unsupported_media_type')
      expect(err.status).toBe(415)
    },
  )

  it('rejects an oversized declared Content-Length with 413', async () => {
    const req = fakeReq({ headers: { ...JSON_HEADERS, 'content-length': String(MAX_BODY_BYTES + 1) }, chunks: ['{}'] })
    const err = await catchError(readJson(req))
    expect(err.code).toBe('payload_too_large')
    expect(err.status).toBe(413)
  })

  it('rejects an oversized streamed body with 413 even without Content-Length', async () => {
    const big = `{"x":"${'a'.repeat(MAX_BODY_BYTES)}"}`
    const chunks = [big.slice(0, 5000), big.slice(5000, 12000), big.slice(12000)]
    const err = await catchError(readJson(fakeReq({ headers: JSON_HEADERS, chunks })))
    expect(err.code).toBe('payload_too_large')
  })

  it('accepts a body of exactly MAX_BODY_BYTES', async () => {
    const text = `"${'a'.repeat(MAX_BODY_BYTES - 2)}"`
    await expect(readJson(fakeReq({ headers: JSON_HEADERS, chunks: [text] }))).resolves.toHaveLength(MAX_BODY_BYTES - 2)
  })

  it('rejects malformed JSON with 400 and does not echo the body', async () => {
    const err = await catchError(readJson(fakeReq({ headers: JSON_HEADERS, chunks: ['{"password":"SECRET-PW", '] })))
    expect(err.code).toBe('bad_request')
    expect(err.status).toBe(400)
    expect(err.message).not.toContain('SECRET-PW')
  })

  it('accepts a body already parsed by the platform', async () => {
    const req = fakeReq({ headers: JSON_HEADERS, body: { email: 'pre@parsed.io' } })
    await expect(readJson(req)).resolves.toEqual({ email: 'pre@parsed.io' })
  })

  it('parses a pre-read string or Buffer body', async () => {
    await expect(readJson(fakeReq({ headers: JSON_HEADERS, body: '{"a":1}' }))).resolves.toEqual({ a: 1 })
    await expect(readJson(fakeReq({ headers: JSON_HEADERS, body: Buffer.from('{"b":2}') }))).resolves.toEqual({ b: 2 })
    const err = await catchError(readJson(fakeReq({ headers: JSON_HEADERS, body: '{oops' })))
    expect(err.code).toBe('bad_request')
  })

  it('still enforces content-type on a pre-parsed body', async () => {
    const err = await catchError(readJson(fakeReq({ headers: { 'content-type': 'text/plain' }, body: { a: 1 } })))
    expect(err.code).toBe('unsupported_media_type')
  })
})

describe('sendJson', () => {
  it('writes status, security headers and the JSON body', () => {
    const headers: Record<string, string> = {}
    let ended = ''
    const res = {
      statusCode: 0,
      setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v },
      end: (b: string) => { ended = b },
    } as unknown as ApiResponse
    sendJson(res, 201, { ok: true }, { 'X-Extra': '1' })
    expect(res.statusCode).toBe(201)
    expect(headers['content-type']).toMatch(/^application\/json/)
    expect(headers['cache-control']).toBe('no-store')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-extra']).toBe('1')
    expect(JSON.parse(ended)).toEqual({ ok: true })
  })
})

describe('limitKeyForIp', () => {
  it('keys IPv4 by address', () => expect(limitKeyForIp('203.0.113.7')).toBe('203.0.113.7'))
  it('keys IPv6 by /64 so address rotation inside one network does not help', () => {
    expect(limitKeyForIp('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64')
    expect(limitKeyForIp('2001:db8:1:2:bbbb::9')).toBe('2001:db8:1:2::/64')
    expect(limitKeyForIp('2001:db8:1:3::1')).not.toBe(limitKeyForIp('2001:db8:1:2::1'))
  })
  it('unmaps IPv4-mapped IPv6', () => expect(limitKeyForIp('::ffff:203.0.113.7')).toBe('203.0.113.7'))
})
