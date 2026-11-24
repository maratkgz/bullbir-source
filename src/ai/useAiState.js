import { useCallback, useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db, firebaseReady } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useDoc } from '../hooks/useDoc'
import { learnFromChoice } from './engine/classifier'

const STATE_COLLECTION = 'aiState'
const STATE_DOC = 'profile'
const MAX_FEEDBACK_WORDS = 300 // keeps the per-user learning doc small

function trimFeedback(feedback) {
  const keys = Object.keys(feedback)
  if (keys.length <= MAX_FEEDBACK_WORDS) return feedback
  return Object.fromEntries(keys.slice(keys.length - MAX_FEEDBACK_WORDS).map((k) => [k, feedback[k]]))
}

/**
 * Per-user assistant state at users/{uid}/aiState/profile:
 *   { consentAllModules: boolean, feedback: { [wordStem]: { [domainId]: count } } }
 * Everything is processed in the browser; this doc only stores the user's own choices.
 */
export function useAiState() {
  const { data, loading, save } = useDoc(STATE_COLLECTION, STATE_DOC)
  const consentAllModules = !!data?.consentAllModules
  const feedback = useMemo(() => data?.feedback || {}, [data?.feedback])

  const setConsent = useCallback((value) => save({ consentAllModules: !!value }), [save])

  const rememberChoice = useCallback(
    (goal, domainId) => save({ feedback: trimFeedback(learnFromChoice(feedback, goal, domainId)) }),
    [save, feedback],
  )

  return { loading, consentAllModules, feedback, setConsent, rememberChoice }
}

/** True when admins/{uid} exists. Admins are assigned only in the Firebase console. */
export function useIsAdmin() {
  const { user, isVerified } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!firebaseReady || !user || !isVerified) { setIsAdmin(false); return undefined }
    getDoc(doc(db, 'admins', user.uid))
      .then((snap) => { if (!cancelled) setIsAdmin(snap.exists()) })
      .catch(() => { if (!cancelled) setIsAdmin(false) })
    return () => { cancelled = true }
  }, [user, isVerified])

  return isAdmin
}
