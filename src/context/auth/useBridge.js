import { useCallback, useRef, useState } from 'react'
import { firebaseReady } from '../../firebase/config'
import { devWarn, probeSession, signInBridge } from './session'

// The Firebase bridge (custom token → Firestore/Storage rules). One in-flight sign-in at a time,
// shared by bootstrap, re-bridge after a credential change, and recovery after permission-denied.

const RECOVER_MAX_ATTEMPTS = 3
const RECOVER_WINDOW_MS = 5 * 60 * 1000

/**
 * @param {{
 *   apiUserRef: { current: object|null },
 *   signingOutRef: { current: boolean },
 *   onSignedOut: () => void,
 * }} deps `onSignedOut` runs when /me answers 401 during a recovery
 */
export function useBridge({ apiUserRef, signingOutRef, onSignedOut }) {
  // Bumped after every successful bridge sign-in: a listener that failed with permission-denied
  // is dead, so data hooks list this in their effect deps to re-subscribe with the new token.
  const [bridgeEpoch, setBridgeEpoch] = useState(0)
  // 'failed' (last recovery could not mint a token) | 'exhausted' (attempt cap hit) | null
  const [bridgeError, setBridgeError] = useState(null)
  const epochRef = useRef(0)
  const bridgePromiseRef = useRef(null)
  const recoverPromiseRef = useRef(null)
  const attemptsRef = useRef([])

  /**
   * Signs the bridge in, sharing the in-flight attempt. `fresh` waits for a running attempt and
   * starts a new one: its token may predate a credential change (password / email).
   * @returns {Promise<boolean>}
   */
  const runBridge = useCallback(async ({ fresh = false } = {}) => {
    if (bridgePromiseRef.current) {
      if (!fresh) return bridgePromiseRef.current
      await bridgePromiseRef.current
      if (bridgePromiseRef.current) return bridgePromiseRef.current
    }
    const attempt = signInBridge()
      .then((ok) => {
        if (ok) {
          epochRef.current += 1
          setBridgeEpoch(epochRef.current)
          setBridgeError(null)
        }
        return ok
      })
      .finally(() => {
        if (bridgePromiseRef.current === attempt) bridgePromiseRef.current = null
      })
    bridgePromiseRef.current = attempt
    return attempt
  }, [])

  /** A fresh sign-in (login, verified, reset) starts with a clean recovery budget. */
  const resetBridgeErrors = useCallback(() => {
    attemptsRef.current = []
    setBridgeError(null)
  }, [])

  const takeAttempt = useCallback(() => {
    const now = Date.now()
    const recent = attemptsRef.current.filter((at) => now - at < RECOVER_WINDOW_MS)
    if (recent.length >= RECOVER_MAX_ATTEMPTS) {
      attemptsRef.current = recent
      return false
    }
    attemptsRef.current = [...recent, now]
    return true
  }, [])

  const recover = useCallback(async () => {
    if (!takeAttempt()) {
      setBridgeError('exhausted')
      return
    }
    const session = await probeSession()
    if (session.status === 'anon') {
      onSignedOut()
      return
    }
    if (session.status === 'unknown') {
      devWarn('Session re-check failed:', session.error)
      return
    }
    const ok = await runBridge()
    if (!ok) setBridgeError('failed')
  }, [onSignedOut, runBridge, takeAttempt])

  /**
   * Bridge dropped or rejected while we think we're signed in (logout-all, session revoke,
   * password or email change elsewhere). Data listeners call this on `permission-denied`,
   * passing the epoch they subscribed with: if a newer token already exists they just
   * re-subscribe. Concurrent calls share one recovery; at most 3 recoveries per 5 minutes.
   * @param {number} [subscribedEpoch]
   */
  const recoverBridge = useCallback((subscribedEpoch) => {
    if (!firebaseReady || !apiUserRef.current || signingOutRef.current) return Promise.resolve()
    if (typeof subscribedEpoch === 'number' && subscribedEpoch < epochRef.current) {
      return Promise.resolve()
    }
    if (recoverPromiseRef.current) return recoverPromiseRef.current
    if (bridgePromiseRef.current) return bridgePromiseRef.current.then(() => undefined)
    const attempt = recover()
      .catch((err) => devWarn('Bridge recovery failed:', err))
      .finally(() => {
        recoverPromiseRef.current = null
      })
    recoverPromiseRef.current = attempt
    return attempt
  }, [apiUserRef, recover, signingOutRef])

  return { bridgeEpoch, bridgeError, runBridge, recoverBridge, resetBridgeErrors }
}
