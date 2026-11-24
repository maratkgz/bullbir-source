import {
  signOut,
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  EmailAuthProvider,
} from 'firebase/auth'
import {
  collection,
  doc,
  getDocs,
  writeBatch,
  deleteDoc,
  terminate,
  clearIndexedDbPersistence,
  waitForPendingWrites,
} from 'firebase/firestore'
import { ref as storageRef, deleteObject } from 'firebase/storage'
import { auth, db, storage, googleProvider } from './config'

// Every per-user subcollection under users/{uid}. Keep in sync with firestore.rules.
export const USER_COLLECTIONS = [
  'tasks', 'journalEntries', 'events', 'transactions', 'moods', 'notes',
  'goals', 'habits', 'pomodoro', 'reminders', 'shifts', 'savingsGoals',
  'mandalas', 'aiState',
]

// Service-worker cache that may hold Firebase/Google API responses.
const SENSITIVE_CACHES = ['firebase-api']
const FIRESTORE_BATCH_LIMIT = 500
const PENDING_WRITES_TIMEOUT_MS = 3000
const RECENT_LOGIN_MS = 5 * 60 * 1000 // Firebase's own requires-recent-login window

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** @param {File} file @returns {'type'|'size'|null} validation error code, null when ok */
export function validateAvatar(file) {
  if (!AVATAR_TYPES.includes(file.type)) return 'type'
  if (file.size > AVATAR_MAX_BYTES) return 'size'
  return null
}

/**
 * Removes everything this browser cached for the signed-in user: the Firestore offline
 * IndexedDB cache and the service-worker API cache. Terminates Firestore, so the page
 * must be reloaded afterwards (callers do a hard navigation).
 */
async function clearLocalData() {
  try {
    await terminate(db)
    await clearIndexedDbPersistence(db)
  } catch (err) {
    // Usually another open tab holds the persistence lock. Server data stays protected by
    // auth, but the local cache survives until that tab is closed — make it visible.
    // eslint-disable-next-line no-console
    console.warn('[BullBir] Could not clear the offline cache (close other BullBir tabs):', err?.code || err)
  }
  if (typeof caches !== 'undefined') {
    await Promise.all(SENSITIVE_CACHES.map((name) => caches.delete(name).catch(() => false)))
  }
}

/** Sign out, wipe local copies of user data, and hard-reload to the login page. */
export async function signOutAndClear() {
  // Give queued offline writes a chance to reach the server before the cache is wiped.
  await Promise.race([
    waitForPendingWrites(db).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, PENDING_WRITES_TIMEOUT_MS)),
  ])
  await signOut(auth)
  await clearLocalData()
  window.location.replace('/login')
}

async function reauthenticate(user, password) {
  const providers = user.providerData.map((p) => p.providerId)
  if (providers.includes('password')) {
    if (!password) {
      const err = new Error('Password required')
      err.code = 'auth/missing-password'
      throw err
    }
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
    return
  }
  if (providers.includes('google.com')) {
    await reauthenticateWithPopup(user, googleProvider)
    return
  }
  // Phone-only accounts: require a recent sign-in up front, so data is never wiped while
  // the final deleteUser() would fail with requires-recent-login.
  const lastSignIn = Date.parse(user.metadata?.lastSignInTime || '')
  if (!lastSignIn || Date.now() - lastSignIn > RECENT_LOGIN_MS) {
    const err = new Error('Recent login required')
    err.code = 'auth/requires-recent-login'
    throw err
  }
}

// Mirrors isVerified() in firestore.rules (`bb_ev` claim from our server's custom token) —
// unverified users cannot read subcollections. Receives the Firebase bridge user.
async function canAccessUserData(user) {
  const { claims } = await user.getIdTokenResult()
  return claims.bb_ev === true
}

async function deleteCollection(uid, name) {
  const snap = await getDocs(collection(db, 'users', uid, name))
  for (let i = 0; i < snap.docs.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(db)
    snap.docs.slice(i, i + FIRESTORE_BATCH_LIMIT).forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
}

/**
 * Permanently deletes the account AND all of its data (Firestore + avatar), then clears
 * local caches. Re-authenticates first so data is never wiped while the auth delete fails.
 * @param {{ password?: string }} options
 */
export async function deleteAccountAndData({ password } = {}) {
  const user = auth.currentUser
  if (!user) return
  await reauthenticate(user, password)

  const { uid } = user
  // Unverified accounts could never write module data (rules), so there is nothing to wipe.
  if (await canAccessUserData(user)) {
    for (const name of USER_COLLECTIONS) {
      await deleteCollection(uid, name)
    }
  }
  await deleteObject(storageRef(storage, `avatars/${uid}`)).catch((e) => {
    if (e?.code !== 'storage/object-not-found') throw e
  })
  await deleteDoc(doc(db, 'users', uid))
  await deleteUser(user)
  await clearLocalData()
  window.location.replace('/')
}
