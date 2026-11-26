import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, firebaseReady } from '../firebase/config'
import { signOutAndClear, deleteAccountAndData } from '../firebase/account'
import { authGet, authPost, authDelete } from '../auth/api'
import { readSignedInHint, subscribeSignOut, writeSignedInHint } from '../auth/sessionSignals'
import { useToast } from '../components/ui/Toast'
import { useLang } from './LangContext'
import {
  devWarn, ensureUserDoc, fetchMe, isUnauthorized, probeSession, toAppUser,
} from './auth/session'
import { useBridge } from './auth/useBridge'
import { useRegistrationDraft } from './auth/useRegistrationDraft'
import { useSessionRestore } from './auth/useSessionRestore'

// Session lives in our httpOnly cookie (/api/auth). Firebase Auth is only an invisible bridge
// to Firestore/Storage rules: custom token, in-memory persistence, re-minted after every reload.

const AuthContext = createContext(null)
const GOOGLE_START_URL = '/api/auth/oauth/google/start'

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

// Pass-through calls with no client state. The server answers 202 to the request-* calls
// (no account enumeration).
const requestLoginCode = async (email) => { await authPost('otp/request', { email }) }
const requestPasswordReset = async (email) => { await authPost('password/reset-request', { email }) }
// Mails a code to the NEW address. Needs the current password (passwordless → password_not_set).
const requestEmailChange = async (newEmail, currentPassword) => {
  await authPost('email/change-request', { newEmail, currentPassword })
}
const listSessions = async () => (await authGet('sessions')).sessions
const listSecurityEvents = async () => (await authGet('security-events')).events

// Google sign-in is a top-level navigation to our server (OAuth code + PKCE); the server
// redirects back to /app with a session cookie, or to /login?error=oauth_*. The promise never
// settles so the caller keeps its loading state until the page unloads (OAuthButtons resets it
// on a bfcache restore).
const loginWithGoogle = () => {
  window.location.assign(GOOGLE_START_URL)
  return new Promise(() => {})
}

export function AuthProvider({ children }) {
  const { t } = useLang()
  const toast = useToast()
  const {
    pendingEmail, hasRegistrationPassword, passwordRef, nameRef,
    setPendingEmail, setRegistrationPassword, clearDraft,
  } = useRegistrationDraft()
  const [apiUser, setApiUser] = useState(null)
  const [profile, setProfile] = useState(null)
  // 'idle' | 'loading' | 'ready' | 'error' — routes wait on 'loading' and show retry on 'error'
  // instead of mistaking a missing profile for "onboarding not done".
  const [profileStatus, setProfileStatusState] = useState('idle')
  const profileStatusRef = useRef('idle')
  const profileLoadRef = useRef(null)
  const apiUserRef = useRef(null)
  const signingOutRef = useRef(false)

  const setProfileStatus = useCallback((status) => {
    profileStatusRef.current = status
    setProfileStatusState(status)
  }, [])

  const publishUser = useCallback((nextUser) => {
    apiUserRef.current = nextUser
    setApiUser(nextUser)
  }, [])

  // Only once the server session is gone: wipe caches, tell the other tabs, hard-reload to /login.
  const finishSignOut = useCallback(async ({ broadcast = true } = {}) => {
    if (signingOutRef.current) return
    signingOutRef.current = true
    clearDraft()
    await signOutAndClear({ broadcast })
  }, [clearDraft])

  const { bridgeEpoch, bridgeError, runBridge, recoverBridge, resetBridgeErrors } = useBridge({
    apiUserRef,
    signingOutRef,
    onSignedOut: finishSignOut,
  })

  /** Loads (or creates) users/{uid}; concurrent calls share one load. @returns {Promise<boolean>} */
  const loadProfile = useCallback((forUser) => {
    if (profileLoadRef.current) return profileLoadRef.current
    setProfileStatus('loading')
    const load = ensureUserDoc(forUser)
      .then((data) => {
        if (apiUserRef.current?.uid !== forUser.uid) return false
        setProfile(data)
        setProfileStatus('ready')
        return true
      })
      .catch((err) => {
        devWarn('Could not load the profile:', err)
        setProfileStatus('error')
        return false
      })
      .finally(() => {
        profileLoadRef.current = null
      })
    profileLoadRef.current = load
    return load
  }, [setProfileStatus])

  // Bridge first, then publish the user, so data hooks never subscribe before request.auth exists.
  const bootstrap = useCallback(async (nextUser) => {
    resetBridgeErrors()
    if (apiUserRef.current?.uid !== nextUser.uid) setProfile(null)
    setProfileStatus('loading')
    const bridged = await runBridge()
    apiUserRef.current = nextUser
    writeSignedInHint(true)
    if (bridged) await loadProfile(nextUser)
    // No Firebase config at all: nothing to load, keep the old "no profile yet" behaviour.
    else setProfileStatus(firebaseReady ? 'error' : 'ready')
    setApiUser(nextUser)
  }, [loadProfile, resetBridgeErrors, runBridge, setProfileStatus])

  // The server bumped the credential version (password / email change): the current bridge
  // token is rejected by the rules, so re-mint it right away and publish the updated user.
  const rebridge = useCallback(async (nextUser) => {
    await runBridge({ fresh: true })
    publishUser(nextUser)
  }, [publishUser, runBridge])

  // /me said 401 on start: a leftover (pre-migration) Firebase session must never outlive ours.
  const onAnonymous = useCallback(async () => {
    writeSignedInHint(false)
    if (!firebaseReady) return
    await auth.authStateReady()
    if (auth.currentUser) await signOut(auth).catch(() => undefined)
  }, [])

  const { loading, sessionUnknown, retryRestore } = useSessionRestore({ bootstrap, onAnonymous })

  // Profile failed to load (bridge down, offline): try again after every new bridge token.
  useEffect(() => {
    const current = apiUserRef.current
    if (current && profileStatusRef.current === 'error') loadProfile(current)
  }, [bridgeEpoch, loadProfile])

  /** Retry button / back online: re-bridge if needed, then load the profile again. */
  const retryProfile = useCallback(async () => {
    const current = apiUserRef.current
    if (!current || profileStatusRef.current !== 'error') return
    setProfileStatus('loading')
    const bridged = auth.currentUser ? true : await runBridge()
    if (bridged) await loadProfile(current)
    else setProfileStatus('error')
  }, [loadProfile, runBridge, setProfileStatus])

  const retrySession = useCallback(
    () => (apiUserRef.current ? retryProfile() : retryRestore()),
    [retryProfile, retryRestore],
  )

  useEffect(() => {
    window.addEventListener('online', retryProfile)
    return () => window.removeEventListener('online', retryProfile)
  }, [retryProfile])

  useEffect(() => {
    if (!firebaseReady) return undefined
    return onAuthStateChanged(auth, (fbUser) => {
      if (!fbUser) recoverBridge()
    })
  }, [recoverBridge])

  // Another tab signed out (logout, logout-all, account deleted): follow it.
  useEffect(() => subscribeSignOut(() => {
    if (!apiUserRef.current) {
      clearDraft()
      return
    }
    publishUser(null)
    finishSignOut({ broadcast: false })
  }), [clearDraft, finishSignOut, publishUser])

  const refreshProfile = useCallback(async () => {
    const uid = apiUserRef.current?.uid
    if (!uid || !auth.currentUser) return
    const snap = await getDoc(doc(db, 'users', uid))
    if (snap.exists()) {
      setProfile(snap.data())
      setProfileStatus('ready')
    }
  }, [setProfileStatus])

  const register = useCallback(async ({ email, password, name }) => {
    await authPost('register', { email, password, ...(name ? { name } : {}) })
    setRegistrationPassword(password, name)
    setPendingEmail(email)
  }, [setPendingEmail, setRegistrationPassword])

  // The account is created only when the code AND the registration password match.
  const verifyEmail = useCallback(async (code, password) => {
    const email = apiUserRef.current?.email ?? pendingEmail
    const pw = password || passwordRef.current
    const { user } = await authPost('verify-email', { email, code, password: pw })
    await bootstrap(user)
    clearDraft()
    return user
  }, [bootstrap, clearDraft, passwordRef, pendingEmail])

  // A new code re-creates the pending registration, so it needs the password (and name) again.
  const resendVerification = useCallback(async (password) => {
    const email = apiUserRef.current?.email ?? pendingEmail
    if (!email) return
    const pw = password || passwordRef.current
    if (!pw) {
      const err = new Error('Password required')
      err.code = 'auth/missing-password'
      throw err
    }
    const name = nameRef.current
    await authPost('verify-email/resend', { email, password: pw, ...(name ? { name } : {}) })
  }, [nameRef, passwordRef, pendingEmail])

  const checkVerified = useCallback(async () => {
    const me = await fetchMe()
    if (!me) return false
    const wasVerified = !!apiUserRef.current?.emailVerified
    // Verified elsewhere: re-mint the bridge so the bb_ev claim reaches the rules.
    if (me.emailVerified && !wasVerified) await bootstrap(me)
    else publishUser(me)
    return !!me.emailVerified
  }, [bootstrap, publishUser])

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
    clearDraft()
    await bootstrap(user)
    return user
  }, [bootstrap, clearDraft, setPendingEmail, setRegistrationPassword])

  const loginWithCode = useCallback(async (email, code) => {
    const { user } = await authPost('otp/verify', { email, code })
    clearDraft()
    await bootstrap(user)
    return user
  }, [bootstrap, clearDraft])

  // Sets the new password and starts a fresh session (all other sessions are ended).
  const confirmPasswordReset = useCallback(async (email, code, newPassword) => {
    const { user } = await authPost('password/reset-confirm', { email, code, newPassword })
    clearDraft()
    await bootstrap(user)
    return user
  }, [bootstrap, clearDraft])

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const { user } = await authPost('password/change', { currentPassword, newPassword })
    await rebridge(user)
    return user
  }, [rebridge])

  const confirmEmailChange = useCallback(async (newEmail, code) => {
    const { user } = await authPost('email/change-confirm', { newEmail, code })
    await rebridge(user)
    return user
  }, [rebridge])

  // Irreversible; ends with a hard navigation to '/'. Listener errors during the delete must not
  // trigger a recovery sign-out racing it.
  const deleteAccount = useCallback(async (currentPassword) => {
    signingOutRef.current = true
    try {
      await deleteAccountAndData({ password: currentPassword })
    } catch (err) {
      signingOutRef.current = false
      throw err
    }
  }, [])

  const completeOnboarding = useCallback(async (data = {}) => {
    const uid = apiUserRef.current?.uid
    if (!uid) return
    await setDoc(doc(db, 'users', uid), { onboardingDone: true, ...data }, { merge: true })
    await refreshProfile()
  }, [refreshProfile])

  // Ends the server session first. Only a 2xx or a 401 (already gone) lets us sign out locally:
  // with a still-valid cookie a local wipe would just sign the user back in on reload.
  // @returns {Promise<boolean>} false when the server could not be reached (a toast says so)
  const logout = useCallback(async () => {
    try {
      await authPost('logout')
    } catch (err) {
      const nothingToEnd = !apiUserRef.current && !readSignedInHint()
      if (!isUnauthorized(err) && !nothingToEnd) {
        devWarn('Sign-out failed:', err)
        toast.error(t('auth.logoutFailed'))
        return false
      }
    }
    await finishSignOut()
    return true
  }, [finishSignOut, t, toast])

  // Same rule as logout; errors are re-thrown for the caller's toast (DevicesCard).
  const logoutAll = useCallback(async () => {
    try {
      await authPost('logout-all')
    } catch (err) {
      if (!isUnauthorized(err)) throw err
    }
    await finishSignOut()
  }, [finishSignOut])

  const revokeSession = useCallback(async (id) => {
    await authDelete(`sessions/${encodeURIComponent(id)}`)
    // Revoking the current session clears our cookie — finish the sign-out locally too.
    if ((await probeSession()).status === 'anon') await finishSignOut()
  }, [finishSignOut])

  const user = useMemo(() => (apiUser ? toAppUser(apiUser, profile) : null), [apiUser, profile])

  const value = {
    user,
    profile,
    profileStatus,
    loading,
    sessionUnknown,
    retrySession,
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
    resendVerification,
    checkVerified,
    requestPasswordReset,
    confirmPasswordReset,
    changePassword,
    requestEmailChange,
    confirmEmailChange,
    deleteAccount,
    recoverBridge,
    bridgeEpoch,
    bridgeError,
    completeOnboarding,
    refreshProfile,
    logout,
    logoutAll,
    listSessions,
    revokeSession,
    listSecurityEvents,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
