import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AppError } from '../../server/errors.js'
import { assertAllowedOrigin, isSafeMethod } from '../../server/origin.js'

const ALLOWED = ['http://localhost:5173', 'https://bullbir.app'] as const

function fakeReq(method: string, origin?: string): IncomingMessage {
  const headers: Record<string, string> = {}
  if (origin !== undefined) headers.origin = origin
  return { method, headers } as unknown as IncomingMessage
}

function expectRejected(req: IncomingMessage): void {
  let caught: unknown
  try {
    assertAllowedOrigin(req, ALLOWED)
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(AppError)
  expect((caught as AppError).code).toBe('origin_rejected')
  expect((caught as AppError).status).toBe(403)
}

describe('isSafeMethod', () => {
  it.each(['GET', 'get', 'HEAD', 'OPTIONS', undefined])('%s is safe', (m) => expect(isSafeMethod(m)).toBe(true))
  it.each(['POST', 'DELETE', 'PUT', 'PATCH'])('%s is not safe', (m) => expect(isSafeMethod(m)).toBe(false))
})

describe('assertAllowedOrigin', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s through without an Origin header', (m) => {
    expect(() => assertAllowedOrigin(fakeReq(m), ALLOWED)).not.toThrow()
  })

  it('lets GET through even from a foreign origin', () => {
    expect(() => assertAllowedOrigin(fakeReq('GET', 'https://evil.example'), ALLOWED)).not.toThrow()
  })

  describe.each(['POST', 'DELETE', 'PUT', 'PATCH'])('%s', (method) => {
    it('is rejected without Origin', () => expectRejected(fakeReq(method)))
    it('is rejected with Origin "null"', () => expectRejected(fakeReq(method, 'null')))
    it('is rejected with an empty Origin', () => expectRejected(fakeReq(method, '')))
    it('is rejected with a malformed Origin', () => expectRejected(fakeReq(method, 'not a url')))
    it.each([
      'https://evil.example',
      'https://bullbir.app.evil.example',
      'http://bullbir.app',
      'https://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
    ])('is rejected from foreign origin %s', (origin) => expectRejected(fakeReq(method, origin)))

    it.each(['http://localhost:5173', 'https://bullbir.app', 'https://bullbir.app/', 'https://bullbir.app/some/path', 'HTTPS://BULLBIR.APP'])(
      'is allowed from %s',
      (origin) => {
        expect(() => assertAllowedOrigin(fakeReq(method, origin), ALLOWED)).not.toThrow()
      },
    )
  })

  it('uses the first value when Origin arrives as an array', () => {
    const req = { method: 'POST', headers: { origin: ['https://evil.example', 'https://bullbir.app'] } } as unknown as IncomingMessage
    expectRejected(req)
  })
})
