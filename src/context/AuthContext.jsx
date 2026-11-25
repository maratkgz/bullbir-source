import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  onAuthStateChanged,
  setPersistence,
  inMemoryPersistence,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db, firebaseReady } from '../firebase/config'
import { signOutAndClear } from '../firebase/account'
import { authGet, authPost, authDelete } from '../auth/api'

// Session lives in our httpOnly cookie (/api/auth). Firebase Auth is only an invisible bridge
// to Firestore/Storage rules: custom token, in-memory persistence, re-minted after every reload.

const AuthContext = createContext(null)
const PENDING_EMAIL_KEY = 'bb.pendingEmail'
const REBRIDGE_MIN_INTERVAL_MS = 30 * 1000
const GOOGLE_START_URL = '/api/auth/oauth/google/start'

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

function notAllowedYet() {
  const err = new Error('This sign-in method is being moved to the new system')
  err.code = 'auth/operation-not-allowed'
  return err
}

function readPendingEmail() {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY)
  } catch {
    return null
  }
}

function writePendingEmail(email) {
  try {
    if (email) sessionStorage.setItem(PENDING_EMAIL_KEY, email)
    else sessionStorage.removeItem(PENDING_EMAIL_KEY)
  } catch {
    // Storage blocked (private mode): pendingEmail just won't survive a reload.
  }
}

function devWarn(message, err) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[BullBir] ${message}`, err?.code || err?.message || err)
  }
}

let persistencePromise = null
function ensureInMemoryPersistence() {
  if (!persistencePromise) persistencePromise = setPersistence(auth, inMemoryPersistence)
  return persistencePromise
}

/** Signs the Firebase bridge in for the current cookie session. @returns {Promise<boolean>} */
async function signInBridge() {
  if (!firebaseReady) return false
  try {
    await ensureInMemoryPersistence()
    const { token } = await authPost('firebase-token')
    await signInWithCustomToken(auth, token)
    return true
  } catch (err) {
    devWarn('Firebase bridge sign-in failed:', err)
    return false
  }
}

async function ensureUserDoc(apiUser) {
  const ref = doc(db, 'users', apiUser.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return snap.data()
  await setDoc(ref, {
    email: apiUser.email || null,
    displayName: apiUser.displayName || null,
    photoURL: null,
    onboardingDone: false,
    createdAt: serverTimestamp(),
  })
  return { onboardingDone: false }
}

/** Shapes our API user like the Firebase User fields the app reads. */
function toAppUser(apiUser, profile) {
  return {
    uid: apiUser.uid,
    email: apiUser.email,
    emailVerified: !!apiUser.emailVerified,
    displayName: profile?.displayName ?? apiUser.displayName ?? null,
    photoURL: profile?.photoURL ?? null,
    phoneNumber: null,
    providerData: (apiUser.providers || []).map((p) => ({ providerId: p })),
    metadata: {
      creationTime: apiUser.createdAt ?? null,
      lastSignInTime: apiUser.lastLoginAt ?? null,
    },
  }
}

async function fetchMe() {
  try {
    const { user } = await authGet('me')
    return user
  } catch (err) {
    if (err.status === 401) return null
    throw err
  }
}

export function AuthProvider({ children }) {
  const [apiUser, setApiUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingEmail, setPendingEmailState] = useState(readPendingEmail)
  // Registration password, kept in memory only (never in storage): verify-email needs it again.
  const registrationPasswordRef = useRef(null)
  const [hasRegistrationPassword, setHasRegistrationPassword] = useState(false)
  const apiUserRef = useRef(null)
  const bridgingRef = useRef(false)
  const lastRebridgeAtRef = useRef(0)

  const setPendingEmail = useCallback((email) => {
    writePendingEmail(email)
    setPendingEmailState(email)
  }, [])

  const registrationNameRef = useRef(null)
  const setRegistrationPassword = useCallback((password, name = null) => {
    registrationPasswordRef.current = password || null
    registrationNameRef.current = password ? name || null : null
    setHasRegistrationPassword(!!password)
  }, [])

  const clearSession = useCallback(() => {
    apiUserRef.current = null
    setApiUser(null)
    setProfile(null)
  }, [])

  // Bridge first, then publish the user, so data hooks never subscribe before request.auth exists.
  const bootstrap = useCallback(async (nextUser) => {
    bridgingRef.current = true
    try {
      const bridged = await signInBridge()
      let nextProfile = null
      if (bridged) {
        try {
          nextProfile = await ensureUserDoc(nextUser)
        } catch (err) {
          devWarn('Could not load the profile:', err)
        }
      }
      apiUserRef.current = nextUser
      setApiUser(nextUser)
      setProfile(nextProfile)
    } finally {
      bridgingRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const me = await fetchMe()
        if (cancelled) return
        if (me) {
          await bootstrap(me)
        } else if (firebaseReady) {
          // A leftover (pre-migration, persisted) Firebase session must never outlive ours.
          await auth.authStateReady()
          if (auth.currentUser) await signOut(auth).catch(() => undefined)
        }
      } catch (err) {
        devWarn('Could not restore the session:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bootstrap])

  // Bridge dropped while we think we're signed in: the server revokes Firebase refresh tokens on
  // logout / session revoke / logout-all. Still signed in with us → re-bridge; otherwise sign out.
  useEffect(() => {
    if (!firebaseReady) return undefined
    return onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser || !apiUserRef.current || bridgingRef.current) return
      try {
        const me = await fetchMe()
        if (!me) {
          clearSession()
          return
        }
        const now = Date.now()
        if (now - lastRebridgeAtRef.current < REBRIDGE_MIN_INTERVAL_MS) return
        lastRebridgeAtRef.current = now
        bridgingRef.current = true
        try {
          await signInBridge()
        } finally {
          bridgingRef.current = false
        }
      } catch (err) {
        devWarn('Session re-check failed:', err)
      }
    })
  }, [clearSession])

  const refreshProfile = useCallback(async () => {
    const uid = apiUserRef.current?.uid
    if (!uid || !auth.currentUser) return
    const snap = await getDoc(doc(db, 'users', uid))
    if (snap.exists()) setProfile(snap.data())
  }, [])

  const register = useCallback(async ({ email, password, name }) => {
    await authPost('register', { email, password, ...(name ? { name } : {}) })
    setRegistrationPassword(password, name)
    setPendingEmail(email)
  }, [setPendingEmail, setRegistrationPassword])

  // The account is created only when the code AND the registration password match.
  const verifyEmail = useCallback(async (code, password) => {
    const email = apiUserRef.current?.email ?? pendingEmail
    const pw = password || registrationPasswordRef.current
    const { user } = await authPost('verify-email', { email, code, password: pw })
    await bootstrap(user)
    setRegistrationPassword(null)
    setPendingEmail(null)
    return user
  }, [bootstrap, pendingEmail, setPendingEmail, setRegistrationPassword])

  // A new code re-creates the pending registration, so it needs the password (and name) again.
  const resendVerification = useCallback(async (password) => {
    const email = apiUserRef.current?.email ?? pendingEmail
    if (!email) return
    const pw = password || registrationPasswordRef.current
    if (!pw) {
      const err = new Error('Password required')
      err.code = 'auth/missing-password'
      throw err
    }
    const name = registrationNameRef.current
    await authPost('verify-email/resend', { email, password: pw, ...(name ? { name } : {}) })
  }, [pendingEmail])

  const checkVerified = useCallback(async () => {
    const me = await fetchMe()
    if (!me) return false
    const wasVerified = !!apiUserRef.current?.emailVerified
    // Verified elsewhere: re-mint the bridge so the bb_ev claim reaches the rules.
    if (me.emailVerified && !wasVerified) await bootstrap(me)
    else {
      apiUserRef.current = me
      setApiUser(me)
    }
    return !!me.emailVerified
  }, [bootstrap])

  const login = useCallback(async ({ email, password }) => {
    let user
    try {
      user = (await authPost('login', { email, password })).user
    } catch (err) {
      // Imported account with an unconfirmed address: the server mailed a code. Continue on the
      // verify screen exactly like a fresh registration (password kept in memory only).
      if (err.apiCode === 'email_unverified') {
        setRegistrationPassword(password, null)
        setPendingEmail(email)
      }
      throw err
    }
    setRegistrationPassword(null)
    setPendingEmail(null)
    await bootstrap(user)
    return user
  }, [bootstrap, setPendingEmail, setRegistrationPassword])

  // Sign-in with a one-time email code. The server always answers 202 (no account enumeration).
  const requestLoginCode = useCallback(async (email) => {
    await authPost('otp/request', { email })
  }, [])

  const loginWithCode = useCallback(async (email, code) => {
    const { user } = await authPost('otp/verify', { email, code })
    setRegistrationPassword(null)
    setPendingEmail(null)
    await bootstrap(user)
    return user
  }, [bootstrap, setPendingEmail, setRegistrationPassword])

  // Google sign-in is a top-level navigation to our server (OAuth code + PKCE); the server
  // redirects back to /app with a session cookie, or to /login?error=oauth_*. The promise never
  // settles so the caller keeps its loading state until the page unloads.
  const loginWithGoogle = useCallback(() => {
    window.location.assign(GOOGLE_START_URL)
    return new Promise(() => {})
  }, [])

  const sendPhoneCode = useCallback(async () => {
    throw notAllowedYet()
  }, [])

  const resetPassword = useCallback(async () => {
    throw notAllowedYet()
  }, [])

  const completeOnboarding = useCallback(async (data = {}) => {
    const uid = apiUserRef.current?.uid
    if (!uid) return
    await setDoc(doc(db, 'users', uid), { onboardingDone: true, ...data }, { merge: true })
    await refreshProfile()
  }, [refreshProfile])

  // Ends the server session, then signs the bridge out and wipes offline caches.
  const logout = useCallback(async () => {
    setRegistrationPassword(null)
    setPendingEmail(null)
    await authPost('logout').catch(() => undefined)
    await signOutAndClear()
  }, [setPendingEmail, setRegistrationPassword])

  const logoutAll = useCallback(async () => {
    await authPost('logout-all')
    setRegistrationPassword(null)
    setPendingEmail(null)
    await signOutAndClear()
  }, [setPendingEmail, setRegistrationPassword])

  const listSessions = useCallback(async () => {
    const { sessions } = await authGet('sessions')
    return sessions
  }, [])

  const revokeSession = useCallback(async (id) => {
    await authDelete(`sessions/${encodeURIComponent(id)}`)
    // Revoking the current session clears our cookie — finish the sign-out locally too.
    if (!(await fetchMe())) await signOutAndClear()
  }, [])

  const user = useMemo(() => (apiUser ? toAppUser(apiUser, profile) : null), [apiUser, profile])

  const value = {
    user,
    profile,
    loading,
    firebaseReady,
    isVerified: !!user && user.emailVerified,
    onboardingDone: !!profile?.onboardingDone,
    pendingEmail,
    hasRegistrationPassword,
    register,
    verifyEmail,
    login,
    requestLoginCode,
    loginWithCode,
    loginWithGoogle,
    sendPhoneCode,
    resendVerification,
    checkVerified,
    resetPassword,
    completeOnboarding,
    refreshProfile,
    logout,
    logoutAll,
    listSessions,
    revokeSession,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
