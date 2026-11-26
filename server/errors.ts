// Errors that are safe to show to the client. Anything else becomes a generic 500.

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'origin_rejected'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'internal'
  | 'service_unavailable'
  | 'invalid_credentials'
  | 'invalid_code'
  | 'weak_password'
  | 'breached_password'
  | 'email_unverified'
  | 'password_not_set'
  | 'reauth_required'

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  origin_rejected: 403,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal: 500,
  service_unavailable: 503,
  invalid_credentials: 401,
  invalid_code: 400,
  weak_password: 400,
  breached_password: 400,
  email_unverified: 403,
  password_not_set: 400,
  reauth_required: 401,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  /** Seconds the client should wait (only for rate_limited). */
  readonly retryAfter: number | undefined
  /** Names of the request fields that failed validation (never their values). */
  readonly fields: string[] | undefined

  constructor(code: ErrorCode, message?: string, options: { retryAfter?: number; fields?: string[] } = {}) {
    super(message ?? code)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS[code]
    this.retryAfter = options.retryAfter
    this.fields = options.fields
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}
