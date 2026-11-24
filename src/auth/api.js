// Thin client for the same-origin auth API (`/api/auth/*`, contract in docs/auth-api.md).
// Errors are re-thrown with Firebase-style `.code` values so `tError()` keeps translating them.

const BASE = '/api/auth/'

const CODE_MAP = {
  invalid_credentials: 'auth/invalid-credential',
  rate_limited: 'auth/too-many-requests',
  weak_password: 'auth/weak-password',
  breached_password: 'auth/password-breached',
  invalid_code: 'auth/invalid-verification-code',
  unauthorized: 'auth/unauthorized',
  email_unverified: 'auth/email-unverified',
}

/**
 * @param {string|undefined} apiCode server error code
 * @param {unknown} body request body that was sent
 * @returns {string} Firebase-style error code
 */
function toClientCode(apiCode, body) {
  if (apiCode && CODE_MAP[apiCode]) return CODE_MAP[apiCode]
  if (apiCode === 'validation_failed') {
    const hasEmail = !!body && typeof body === 'object' && 'email' in body
    return hasEmail ? 'auth/invalid-email' : 'auth/internal'
  }
  return 'auth/internal'
}

/**
 * @param {string} code
 * @param {string} message
 * @param {{ status?: number, retryAfter?: number|null, apiCode?: string }} [extra]
 */
function authError(code, message, extra = {}) {
  const err = new Error(message)
  err.code = code
  err.status = extra.status ?? 0
  err.retryAfter = extra.retryAfter ?? null
  if (extra.apiCode) err.apiCode = extra.apiCode
  return err
}

async function readJson(res) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Calls `/api/auth/<path>`.
 * @param {string} path e.g. 'login', 'me', 'sessions/abc'
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>} parsed JSON body on success
 */
export async function authApi(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const init = {
    method,
    credentials: 'same-origin',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }

  let res
  try {
    res = await fetch(BASE + path, init)
  } catch {
    throw authError('auth/network-request-failed', 'Network request failed')
  }

  const data = await readJson(res)
  if (res.ok) return data

  const apiCode = data?.error?.code
  const retryHeader = Number(res.headers.get('Retry-After'))
  throw authError(toClientCode(apiCode, body), apiCode || `HTTP ${res.status}`, {
    status: res.status,
    retryAfter: Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null,
    apiCode,
  })
}

export const authGet = (path) => authApi(path)
export const authPost = (path, body) => authApi(path, { method: 'POST', body })
export const authDelete = (path) => authApi(path, { method: 'DELETE' })
