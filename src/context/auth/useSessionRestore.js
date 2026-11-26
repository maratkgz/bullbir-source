import { useCallback, useEffect, useRef, useState } from 'react'
import { readSignedInHint } from '../../auth/sessionSignals'
import { devWarn, probeSession } from './session'

// Restores the cookie session on start. Only a 401 from /me means "signed out": a network error,
// timeout or 5xx is "unknown" and is retried with backoff and on the `online` event. While it is
// unknown and this browser was signed in before, `sessionUnknown` lets the routes show a
// retry/offline screen instead of sending the user to /login.

const RETRY_BASE_MS = 2 * 1000
const RETRY_MAX_MS = 60 * 1000

/**
 * @param {{ bootstrap: (user: object) => Promise<void>, onAnonymous: () => Promise<void> }} deps
 */
export function useSessionRestore({ bootstrap, onAnonymous }) {
  const [loading, setLoading] = useState(true)
  const [sessionUnknown, setSessionUnknown] = useState(false)
  const runningRef = useRef(null)
  const timerRef = useRef(null)
  const failuresRef = useRef(0)
  const unknownRef = useRef(false)
  const restoreRef = useRef(null)

  const scheduleRetry = useCallback(() => {
    const delay = Math.min(RETRY_BASE_MS * 2 ** failuresRef.current, RETRY_MAX_MS)
    failuresRef.current += 1
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => restoreRef.current?.(), delay)
  }, [])

  const settle = useCallback(async (session) => {
    if (session.status === 'unknown') {
      devWarn('Could not restore the session:', session.error)
      unknownRef.current = true
      setSessionUnknown(readSignedInHint())
      scheduleRetry()
      return
    }
    unknownRef.current = false
    failuresRef.current = 0
    setSessionUnknown(false)
    if (session.status === 'user') await bootstrap(session.user)
    else await onAnonymous()
  }, [bootstrap, onAnonymous, scheduleRetry])

  /** Asks /me again; concurrent calls share one request. */
  const restore = useCallback(() => {
    if (runningRef.current) return runningRef.current
    clearTimeout(timerRef.current)
    const run = probeSession()
      .then(settle)
      .catch((err) => devWarn('Session restore failed:', err))
      .finally(() => {
        runningRef.current = null
        setLoading(false)
      })
    runningRef.current = run
    return run
  }, [settle])

  useEffect(() => {
    restoreRef.current = restore
  }, [restore])

  // Once per mount (the latest `restore` is read through the ref).
  useEffect(() => {
    restoreRef.current?.()
    const onOnline = () => {
      if (unknownRef.current) restoreRef.current?.()
    }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      clearTimeout(timerRef.current)
    }
  }, [])

  return { loading, sessionUnknown, retryRestore: restore }
}
