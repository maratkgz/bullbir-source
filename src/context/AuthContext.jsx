import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  signInWithPopup,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  reload,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db, googleProvider, appleProvider, firebaseReady } from '../firebase/config'

const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

async function ensureUserDoc(user, extra = {}) {
  const ref = doc(db, 'users', user.uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email || null,
      displayName: user.displayName || extra.displayName || null,
      photoURL: user.photoURL || null,
      onboardingDone: false,
      createdAt: serverTimestamp(),
      ...extra,
    })
    return { onboardingDone: false }
  }
  return snap.data()
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!firebaseReady) {
      setLoading(false)
      return undefined
    }
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        try {
          const data = await ensureUserDoc(u)
          setProfile(data)
        } catch {
          setProfile(null)
        }
      } else {
        setProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return
    const snap = await getDoc(doc(db, 'users', auth.currentUser.uid))
    if (snap.exists()) setProfile(snap.data())
  }, [])

  const register = useCallback(async ({ email, password, name }) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    if (name) await updateProfile(cred.user, { displayName: name })
    await ensureUserDoc(cred.user, { displayName: name || null })
    await sendEmailVerification(cred.user)
    return cred.user
  }, [])

  const login = useCallback(async ({ email, password }) => {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    return cred.user
  }, [])

  const loginWithGoogle = useCallback(async () => {
    const cred = await signInWithPopup(auth, googleProvider)
    await ensureUserDoc(cred.user)
    return cred.user
  }, [])

  const loginWithApple = useCallback(async () => {
    const cred = await signInWithPopup(auth, appleProvider)
    await ensureUserDoc(cred.user)
    return cred.user
  }, [])

  const setupRecaptcha = useCallback((containerId) => {
    if (window.recaptchaVerifier) return window.recaptchaVerifier
    window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: 'invisible',
    })
    return window.recaptchaVerifier
  }, [])

  const sendPhoneCode = useCallback(
    async (phoneNumber, containerId) => {
      const verifier = setupRecaptcha(containerId)
      return signInWithPhoneNumber(auth, phoneNumber, verifier)
    },
    [setupRecaptcha],
  )

  const resendVerification = useCallback(async () => {
    if (auth.currentUser) await sendEmailVerification(auth.currentUser)
  }, [])

  const checkVerified = useCallback(async () => {
    if (!auth.currentUser) return false
    await reload(auth.currentUser)
    setUser({ ...auth.currentUser })
    return auth.currentUser.emailVerified
  }, [])

  const resetPassword = useCallback(async (email) => {
    await sendPasswordResetEmail(auth, email)
  }, [])

  const completeOnboarding = useCallback(async (data = {}) => {
    if (!auth.currentUser) return
    await setDoc(
      doc(db, 'users', auth.currentUser.uid),
      { onboardingDone: true, ...data },
      { merge: true },
    )
    await refreshProfile()
  }, [refreshProfile])

  const logout = useCallback(async () => {
    await fbSignOut(auth)
  }, [])

  const value = {
    user,
    profile,
    loading,
    firebaseReady,
    isVerified: !!user && (user.emailVerified || (!!user.phoneNumber && !user.email)),
    onboardingDone: !!profile?.onboardingDone,
    register,
    login,
    loginWithGoogle,
    loginWithApple,
    sendPhoneCode,
    resendVerification,
    checkVerified,
    resetPassword,
    completeOnboarding,
    refreshProfile,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
