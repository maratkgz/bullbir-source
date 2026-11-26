// Sends crash reports to our server (POST /api/auth/client-errors) so errors that only happen on
// users' devices (e.g. Safari on iPhone) show up in the server logs. No user content is sent:
// only the error message/stack, the page path (no query) and the browser name.
const ENDPOINT = '/api/auth/client-errors'
const MAX_PER_PAGE_LOAD = 10
let sent = 0
const seen = new Set()

function clip(value, max) {
  const s = typeof value === 'string' ? value : String(value ?? '')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/**
 * @param {'render'|'error'|'rejection'} kind
 * @param {unknown} error
 * @param {string} [component] React component stack (error boundary)
 */
export function reportError(kind, error, component) {
  try {
    const err = error instanceof Error ? error : new Error(clip(error, 500))
    const key = `${kind}:${err.message}`
    if (seen.has(key) || sent >= MAX_PER_PAGE_LOAD) return
    seen.add(key)
    sent += 1
    const body = JSON.stringify({
      kind,
      message: clip(`${err.name}: ${err.message}`, 500),
      stack: err.stack ? clip(err.stack, 2000) : undefined,
      component: component ? clip(component, 1000) : undefined,
      path: clip(window.location.pathname, 200),
      userAgent: clip(navigator.userAgent, 300),
    })
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body,
    }).catch(() => {})
  } catch {
    // Reporting must never cause another error.
  }
}

/** Global listeners: uncaught errors and unhandled promise rejections. */
export function installGlobalErrorReporting() {
  window.addEventListener('error', (event) => {
    if (event?.error) reportError('error', event.error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportError('rejection', event?.reason)
  })
}
