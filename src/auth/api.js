// Thin client for the same-origin auth API (`/api/auth/*`, contract in docs/auth-api.md).
// Errors are re-thrown with Firebase-style `.code` values so `tError()` keeps translating them.

const BASE = '/api/auth/'
const REQUEST_TIMEOUT_MS = 15 * 1000
const HTTP_NO_CONTENT = 204

const CODE_MAP = {
  invalid_credentials: 'auth/invalid-credential',
  rate_limited: 'auth/too-many-requests',
  weak_password: 'auth/weak-password',
  breached_password: 'auth/password-breached',
  invalid_code: 'auth/invalid-verification-code',
  unauthorized: 'auth/unauthorized',
  email_unverified: 'auth/email-unverified',
  password_not_set: 'auth/password-not-set',
  reauth_required: 'auth/requires-recent-login',
  service_unavailable: 'auth/service-unavailable',
  origin_rejected: 'auth/internal',
  payload_too_large: 'auth/internal',
}

// `validation_failed` carries `error.fields` (names of the failing body fields). First match wins.
const VALIDATION_FIELD_CODES = [
  [['code'], 'auth/invalid-verification-code'],
  [['email', 'newEmail'], 'auth/invalid-email'],
  [['password', 'newPassword'], 'auth/weak-password'],
  [['currentPassword'], 'auth/invalid-input'],
]

/**
 * @param {string[]|undefined} fields `error.fields` from the response body
 * @returns {string} Firebase-style error code
 */
function validationCode(fields) {
  if (!fields || fields.length === 0) return 'auth/internal'
  const match = VALIDATION_FIELD_CODES.find(([names]) => names.some((n) => fields.includes(n)))
  return match ? match[1] : 'auth/invalid-input'
}

/**
 * @param {string|undefined} apiCode server error code
 * @param {string[]|undefined} fields `error.fields` (validation_failed only)
 * @returns {string} Firebase-style error code
 */
function toClientCode(apiCode, fields) {
  if (apiCode && CODE_MAP[apiCode]) return CODE_MAP[apiCode]
  if (apiCode === 'validation_failed') return validationCode(fields)
  return 'auth/internal'
}

/**
 * @param {string} code
 * @param {string} message
 * @param {{ status?: number, retryAfter?: number|null, apiCode?: string, fields?: string[] }} [extra]
 */
function authError(code, message, extra = {}) {
  const err = new Error(message)
  err.code = code
  err.status = extra.status ?? 0
  err.retryAfter = extra.retryAfter ?? null
  if (extra.apiCode) err.apiCode = extra.apiCode
  if (extra.fields) err.fields = extra.fields
  return err
}

/** @returns {Promise<{ ok: boolean, data: any }>} `ok` false when the body is not valid JSON */
async function readJson(res) {
  try {
    return { ok: true, data: await res.json() }
  } catch {
    return { ok: false, data: null }
  }
}

/** @param {Response} res @returns {number|null} seconds */
function readRetryAfter(res) {
  const seconds = Number(res.headers.get('Retry-After'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

/** fetch() with a hard timeout; any transport failure becomes auth/network-request-failed. */
async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch {
    throw authError('auth/network-request-failed', 'Network request failed')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Calls `/api/auth/<path>`.
 * @param {string} path e.g. 'login', 'me', 'sessions/abc'
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>} parsed JSON body on success (`{}` for 204)
 */
export async function authApi(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetchWithTimeout(BASE + path, {
    method,
    credentials: 'same-origin',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (res.status === HTTP_NO_CONTENT) return {}
  const parsed = await readJson(res)

  if (res.ok) {
    // A proxy/CDN page instead of our JSON: never hand callers `null` to destructure.
    if (!parsed.ok || parsed.data === null || typeof parsed.data !== 'object') {
      throw authError('auth/internal', 'Unexpected response', { status: res.status })
    }
    return parsed.data
  }

  const apiError = parsed.data?.error
  const apiCode = typeof apiError?.code === 'string' ? apiError.code : undefined
  const fields = Array.isArray(apiError?.fields)
    ? apiError.fields.filter((f) => typeof f === 'string')
    : undefined
  throw authError(toClientCode(apiCode, fields), apiCode || `HTTP ${res.status}`, {
    status: res.status,
    retryAfter: readRetryAfter(res),
    apiCode,
    fields,
  })
}

export const authGet = (path) => authApi(path)
export const authPost = (path, body) => authApi(path, { method: 'POST', body })
export const authDelete = (path) => authApi(path, { method: 'DELETE' })
