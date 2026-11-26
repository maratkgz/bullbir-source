// Stage 7 account operations (Admin SDK): set a password, move an account to a new address,
// delete an account with everything that belongs to it.
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminBucket, adminDb } from '../firebaseAdmin.js'
import { log } from '../log.js'
import { tombstoneCredentials } from './credentials.js'
import { emailKey } from './email.js'
import { SECURITY_EVENTS } from './events.js'
import { OTP } from './otp.js'
import { SESSIONS, deleteAll, revokeFirebaseTokens } from './sessions.js'
import { THROTTLE } from './throttle.js'
import { now } from './time.js'
import { ACCOUNTS, EMAILS, USERS, findUserByEmail, isAddressTaken } from './users.js'

/**
 * Sets a new password. `passwordChangedAt` moves forward, which ends every session created
 * before it (see currentUser); the legacy Firebase hash is dropped.
 */
export async function setPassword(uid: string, passwordHash: string): Promise<void> {
  const ts = new Date(now())
  await adminDb().collection(USERS).doc(uid).update({
    passwordHash,
    legacyPassword: null,
    providers: FieldValue.arrayUnion('password'),
    passwordChangedAt: ts,
    updatedAt: ts,
  })
}

async function deleteWhere(collection: string, field: string, value: string): Promise<void> {
  const db = adminDb()
  const snap = await db.collection(collection).where(field, '==', value).get()
  await deleteAll(snap.docs.map((d) => d.ref))
}

/** Drops codes still waiting for this account (login / reset / email change) after a credential change. */
export async function dropPendingCodes(uid: string): Promise<void> {
  await deleteWhere(OTP, 'data.uid', uid)
}

/**
 * Can `email` become the new address of an account? Not if ANY record holds it here (verified or
 * not — the unique index would refuse it) or it still lives only in legacy Firebase Auth.
 */
export async function isAddressAvailable(email: string): Promise<boolean> {
  if (await findUserByEmail(email)) return false
  return !(await isAddressTaken(email))
}

/**
 * Moves the account to `newEmail` (already proven by a code). Fails (returns false) if the new
 * address is taken — also by an account still only in legacy Firebase Auth. In the same
 * transaction `passwordChangedAt` moves forward, so every existing session ends atomically with
 * the move. The profile doc users/{uid}.email follows (clients can't write it).
 */
export async function changeAccountEmail(uid: string, oldEmail: string, newEmail: string): Promise<boolean> {
  if (!(await isAddressAvailable(newEmail))) return false
  const db = adminDb()
  const newIndex = db.collection(EMAILS).doc(emailKey(newEmail))
  const oldIndex = db.collection(EMAILS).doc(emailKey(oldEmail))
  const userRef = db.collection(USERS).doc(uid)
  const moved = await db.runTransaction(async (tx) => {
    const [taken, user, old] = await Promise.all([tx.get(newIndex), tx.get(userRef), tx.get(oldIndex)])
    if (taken.exists || !user.exists || user.get('email') !== oldEmail || user.get('status') !== 'active') return false
    const ts = new Date(now())
    tx.create(newIndex, { uid, createdAt: ts })
    if (old.exists && old.get('uid') === uid) tx.delete(oldIndex)
    tx.update(userRef, { email: newEmail, emailVerified: true, passwordChangedAt: ts, updatedAt: ts })
    tx.set(db.collection('users').doc(uid), { email: newEmail }, { merge: true })
    return true
  })
  if (moved) await syncFirebaseEmail(uid, newEmail)
  return moved
}

/**
 * Imported accounts still carry their address on the Firebase Auth record; leaving the old one
 * there would keep it "taken" forever (isAddressTaken checks legacy Auth). The record is only a
 * bridge, so it follows our address.
 */
async function syncFirebaseEmail(uid: string, email: string): Promise<void> {
  try {
    await adminAuth().updateUser(uid, { email, emailVerified: true })
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code !== 'auth/user-not-found') log.error('firebase email sync failed', { failure: code ?? 'unknown' })
  }
}

/**
 * Step 1 of deletion, atomic: the account stops working before anything is deleted — status
 * 'deleting' (every login path requires 'active'), sessions invalidated via passwordChangedAt,
 * the address released. If a later step fails, the account is unusable, never half-alive.
 */
async function markDeleting(uid: string, email: string): Promise<void> {
  const db = adminDb()
  const userRef = db.collection(USERS).doc(uid)
  const indexRef = db.collection(EMAILS).doc(emailKey(email))
  await db.runTransaction(async (tx) => {
    const index = await tx.get(indexRef)
    const ts = new Date(now())
    tx.update(userRef, { status: 'deleting', passwordChangedAt: ts, updatedAt: ts })
    if (index.exists && index.get('uid') === uid) tx.delete(indexRef)
  })
}

/** avatars/{uid} — personal data; a failure is logged (the rest of the deletion continues). */
async function deleteAvatar(uid: string): Promise<void> {
  const bucket = adminBucket()
  if (!bucket) {
    log.warn('storage bucket not configured; avatar not deleted', {})
    return
  }
  try {
    await bucket.file(`avatars/${uid}`).delete({ ignoreNotFound: true })
  } catch (err) {
    log.error('avatar delete failed', { err })
  }
}

/**
 * Deletes the account and everything that belongs to it: the user's Firestore data
 * (users/{uid} with all sub-collections), account records, codes, lock, sessions and the user's
 * Firebase Auth record (the user asked for deletion — keeping it would keep their email).
 * The avatar in Storage is deleted here too (after the password check). Every step is idempotent,
 * so a retry finishes a deletion that was interrupted.
 */
export async function deleteAccount(uid: string, email: string): Promise<void> {
  const db = adminDb()
  await markDeleting(uid, email)
  await deleteAvatar(uid)
  // No old Firebase token may read or write anymore (rules check the credential version).
  await tombstoneCredentials(uid)
  await revokeFirebaseTokens(uid)
  await deleteWhere(SESSIONS, 'uid', uid)
  await db.recursiveDelete(db.collection('users').doc(uid))
  await deleteWhere(ACCOUNTS, 'uid', uid)
  await deleteWhere(SECURITY_EVENTS, 'uid', uid)
  await dropPendingCodes(uid)
  await db.collection(THROTTLE).doc(emailKey(email)).delete()
  try {
    await adminAuth().deleteUser(uid)
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') {
      // The account is already unusable on our side; a leftover Firebase record can't sign in.
      log.error('firebase user delete failed', { err })
    }
  }
  await db.collection(USERS).doc(uid).delete()
}
