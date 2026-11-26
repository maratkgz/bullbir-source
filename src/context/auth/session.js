import { signInWithCustomToken } from 'firebase/auth'
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { auth, db, firebaseReady } from '../../firebase/config'
import { authGet, authPost } from '../../auth/api'

// Pure session helpers for AuthProvider: no React state in here.

const PENDING_EMAIL_KEY = 'bb.pendingEmail'
const HTTP_UNAUTHORIZED = 401

export function readPendingEmail() {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY)
  } catch {
    return null
  }
}

export function writePendingEmail(email) {
  try {
    if (email) sessionStorage.setItem(PENDING_EMAIL_KEY, email)
    else sessionStorage.removeItem(PENDING_EMAIL_KEY)
  } catch {
    // Storage blocked (private mode): pendingEmail just won't survive a reload.
  }
}

export function devWarn(message, err) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[BullBir] ${message}`, err?.code || err?.message || err)
  }
}

/** Signs the Firebase bridge in for the current cookie session. @returns {Promise<boolean>} */
export async function signInBridge() {
  if (!firebaseReady) return false
  try {
    const { token } = await authPost('firebase-token')
    await signInWithCustomToken(auth, token)
    return true
  } catch (err) {
    devWarn('Firebase bridge sign-in failed:', err)
    return false
  }
}

function newUserDoc(apiUser) {
  return {
    email: apiUser.email || null,
    displayName: apiUser.displayName || null,
    photoURL: null,
    onboardingDone: false,
    createdAt: serverTimestamp(),
  }
}

/**
 * Loads users/{uid}, creating it only when missing. The read goes through the offline cache; the
 * create is a transaction, so a second tab can never overwrite an existing `onboardingDone`.
 * @returns {Promise<object>} profile data
 */
export async function ensureUserDoc(apiUser) {
  const ref = doc(db, 'users', apiUser.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return snap.data()
  return runTransaction(db, async (tx) => {
    const current = await tx.get(ref)
    if (current.exists()) return current.data()
    tx.set(ref, newUserDoc(apiUser))
    return { onboardingDone: false }
  })
}

/** Shapes our API user like the Firebase User fields the app reads. */
export function toAppUser(apiUser, profile) {
  return {
    uid: apiUser.uid,
    email: apiUser.email,
    emailVerified: !!apiUser.emailVerified,
    displayName: profile?.displayName ?? apiUser.displayName ?? null,
    photoURL: profile?.photoURL ?? null,
    providerData: (apiUser.providers || []).map((p) => ({ providerId: p })),
    metadata: {
      creationTime: apiUser.createdAt ?? null,
      lastSignInTime: apiUser.lastLoginAt ?? null,
    },
  }
}

/**
 * Asks the server who is signed in. Only a 401 means "signed out": a network error, timeout or
 * 5xx says nothing about the session, so it comes back as 'unknown'.
 * @returns {Promise<{ status: 'user', user: object } | { status: 'anon' } | { status: 'unknown', error: Error }>}
 */
export async function probeSession() {
  try {
    const { user } = await authGet('me')
    return user ? { status: 'user', user } : { status: 'anon' }
  } catch (err) {
    if (err.status === HTTP_UNAUTHORIZED) return { status: 'anon' }
    return { status: 'unknown', error: err }
  }
}

/** @returns {Promise<object|null>} the API user, null when signed out; throws when unknown */
export async function fetchMe() {
  const result = await probeSession()
  if (result.status === 'unknown') throw result.error
  return result.status === 'user' ? result.user : null
}

export const isUnauthorized = (err) => err?.status === HTTP_UNAUTHORIZED
