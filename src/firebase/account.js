import { signOut } from 'firebase/auth'
import {
  terminate,
  clearIndexedDbPersistence,
  waitForPendingWrites,
} from 'firebase/firestore'
import { auth, db } from './config'
import { authPost } from '../auth/api'
import { broadcastSignOut, writeSignedInHint } from '../auth/sessionSignals'

// Every per-user subcollection under users/{uid}. Keep in sync with firestore.rules.
export const USER_COLLECTIONS = [
  'tasks', 'journalEntries', 'events', 'transactions', 'moods', 'notes',
  'goals', 'habits', 'pomodoro', 'reminders', 'shifts', 'savingsGoals',
  'mandalas', 'aiState',
]

// Service-worker cache that may hold Firebase/Google API responses.
const SENSITIVE_CACHES = ['firebase-api']
const PENDING_WRITES_TIMEOUT_MS = 3000

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

/** Waits for queued offline writes, at most PENDING_WRITES_TIMEOUT_MS. */
async function flushPendingWrites() {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, PENDING_WRITES_TIMEOUT_MS)
  })
  try {
    await Promise.race([waitForPendingWrites(db).catch(() => undefined), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Sign out, wipe local copies of user data, and hard-reload to the login page. Call it only once
 * the server session is gone (logout answered 2xx/401): otherwise the cookie signs the user back in.
 * @param {{ broadcast?: boolean }} [options] false when another tab already announced the sign-out
 */
export async function signOutAndClear({ broadcast = true } = {}) {
  writeSignedInHint(false)
  if (broadcast) broadcastSignOut()
  // Give queued offline writes a chance to reach the server before the cache is wiped.
  await flushPendingWrites()
  await signOut(auth).catch(() => undefined)
  await clearLocalData()
  window.location.replace('/login')
}

/**
 * Permanently deletes the account AND all of its data, then clears local caches.
 * The server re-authenticates (password) and then deletes everything: Firestore data, the avatar
 * in Storage, auth records and the Firebase Auth user (docs/auth-api.md, `account/delete`).
 * @param {{ password: string }} options current password (required; passwordless accounts must
 *   set one first — the server answers password_not_set)
 */
export async function deleteAccountAndData({ password }) {
  if (!password) {
    const err = new Error('Password required')
    err.code = 'auth/missing-password'
    throw err
  }
  await authPost('account/delete', { currentPassword: password })
  writeSignedInHint(false)
  broadcastSignOut()
  await clearLocalData()
  window.location.replace('/')
}
