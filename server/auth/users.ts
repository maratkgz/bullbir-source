// Account records (Admin SDK only; the client is denied by firestore.rules).
//   users_auth/{uid}          — the account
//   auth_emails/{emailKey}    — { uid }: makes an address unique, written in the same transaction
import { adminAuth, adminDb } from '../firebaseAdmin.js'
import { log } from '../log.js'
import { newUid } from './crypto.js'
import { emailKey } from './email.js'
import { now, toIso } from './time.js'

export const USERS = 'users_auth'
export const EMAILS = 'auth_emails'
export const ACCOUNTS = 'auth_accounts'

export type AuthUser = {
  uid: string
  email: string
  emailVerified: boolean
  passwordHash: string | null
  displayName: string | null
  providers: string[]
  status: string
  /** Old Firebase scrypt hash, until the first successful login re-hashes it with argon2id. */
  legacyPassword: { hash: string; salt: string } | null
  passwordChangedAt: unknown
  createdAt: unknown
  lastLoginAt: unknown
}

export type PublicUser = {
  uid: string
  email: string
  emailVerified: boolean
  displayName: string | null
  providers: string[]
  createdAt: string | null
  lastLoginAt: string | null
}

export function publicUser(u: AuthUser): PublicUser {
  return {
    uid: u.uid,
    email: u.email,
    emailVerified: u.emailVerified,
    displayName: u.displayName,
    providers: u.providers,
    createdAt: toIso(u.createdAt),
    lastLoginAt: toIso(u.lastLoginAt),
  }
}

function fromDoc(uid: string, data: FirebaseFirestore.DocumentData): AuthUser {
  return {
    uid,
    email: String(data.email),
    emailVerified: data.emailVerified === true,
    passwordHash: typeof data.passwordHash === 'string' ? data.passwordHash : null,
    displayName: typeof data.displayName === 'string' ? data.displayName : null,
    providers: Array.isArray(data.providers) ? data.providers.map(String) : [],
    status: typeof data.status === 'string' ? data.status : 'active',
    legacyPassword: typeof data.legacyPassword?.hash === 'string' && typeof data.legacyPassword?.salt === 'string'
      ? { hash: data.legacyPassword.hash, salt: data.legacyPassword.salt }
      : null,
    passwordChangedAt: data.passwordChangedAt ?? null,
    createdAt: data.createdAt,
    lastLoginAt: data.lastLoginAt ?? null,
  }
}

export async function getUser(uid: string): Promise<AuthUser | null> {
  const snap = await adminDb().collection(USERS).doc(uid).get()
  return snap.exists ? fromDoc(uid, snap.data() ?? {}) : null
}

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const index = await adminDb().collection(EMAILS).doc(emailKey(email)).get()
  const uid = index.get('uid')
  return typeof uid === 'string' ? getUser(uid) : null
}

/**
 * Accounts that still live only in Firebase Auth (imported in stage 3). Until then, an address
 * known there counts as taken, so nobody can create a duplicate account for it.
 */
export async function existsInLegacyAuth(email: string): Promise<boolean> {
  try {
    await adminAuth().getUserByEmail(email)
    return true
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') return false
    log.error('legacy account lookup failed', { err })
    throw err
  }
}

/** True when the address already belongs to a verified account (ours or still only in Firebase). */
export async function isAddressTaken(email: string): Promise<boolean> {
  const user = await findUserByEmail(email)
  if (user) return user.emailVerified
  return existsInLegacyAuth(email)
}

function newAccountDoc(input: { email: string; passwordHash: string; displayName: string | null }, ts: Date) {
  return {
    email: input.email,
    emailVerified: true,
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    providers: ['password'],
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
    lastLoginAt: null,
    passwordChangedAt: ts,
  }
}

/**
 * Creates the account once the mailbox owner has proven the address (code + password).
 * A legacy UNVERIFIED record for the same address is taken over with the new password;
 * a verified one wins (returns null — someone else completed first).
 */
export async function createVerifiedUser(input: {
  email: string
  passwordHash: string
  displayName: string | null
}): Promise<AuthUser | null> {
  const db = adminDb()
  const indexRef = db.collection(EMAILS).doc(emailKey(input.email))
  return db.runTransaction(async (tx) => {
    const index = await tx.get(indexRef)
    const ts = new Date(now())
    const existingUid = index.get('uid')
    if (typeof existingUid === 'string') {
      const userRef = db.collection(USERS).doc(existingUid)
      const snap = await tx.get(userRef)
      if (snap.exists && snap.get('emailVerified') === true) return null
      if (!snap.exists) {
        // Corrupt index (points at nothing): repair it by creating the account fresh.
        const uid = newUid()
        const doc = newAccountDoc(input, ts)
        tx.set(indexRef, { uid, createdAt: ts })
        tx.create(db.collection(USERS).doc(uid), doc)
        return fromDoc(uid, doc)
      }
      // Take-over of an UNVERIFIED record (e.g. imported, possibly pre-registered by someone else):
      // the mailbox owner gets a clean account — old password and provider links are wiped.
      const links = await tx.get(db.collection(ACCOUNTS).where('uid', '==', existingUid))
      for (const link of links.docs) tx.delete(link.ref)
      tx.update(userRef, {
        emailVerified: true,
        passwordHash: input.passwordHash,
        legacyPassword: null,
        providers: ['password'],
        updatedAt: ts,
        passwordChangedAt: ts,
      })
      return fromDoc(existingUid, {
        ...snap.data(), emailVerified: true, passwordHash: input.passwordHash, legacyPassword: null,
        providers: ['password'], passwordChangedAt: ts,
      })
    }
    const uid = newUid()
    const doc = newAccountDoc(input, ts)
    tx.create(indexRef, { uid, createdAt: ts })
    tx.create(db.collection(USERS).doc(uid), doc)
    return fromDoc(uid, doc)
  })
}

/**
 * Lazy migration: the old Firebase password was just verified — store its argon2id hash and drop
 * the legacy one. Only if the legacy hash is still there (two parallel logins can't both apply).
 */
export async function completeLegacyMigration(uid: string, passwordHash: string): Promise<void> {
  const db = adminDb()
  const ref = db.collection(USERS).doc(uid)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    // Apply only to an untouched imported account: never overwrite a password set meanwhile
    // (reset/change) and never revive a disabled account.
    if (!snap.exists || snap.get('legacyPassword') == null) return
    if (snap.get('passwordHash') != null || (snap.get('status') ?? 'active') !== 'active') return
    const ts = new Date(now())
    // passwordChangedAt stays: the password itself did not change, sessions remain valid.
    tx.update(ref, { passwordHash, legacyPassword: null, migratedAt: ts, updatedAt: ts })
  })
}

/**
 * The mailbox owner proved an UNVERIFIED account's address with an emailed code (code login).
 * Whoever created the record may know its password or have linked a provider, so all old
 * credentials go: password, legacy hash, provider links. The owner can set a password later.
 * Callers must also end all sessions (revokeAllSessions).
 */
export async function claimUnverifiedAccount(uid: string): Promise<void> {
  const db = adminDb()
  const ref = db.collection(USERS).doc(uid)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.get('emailVerified') === true) return
    const links = await tx.get(db.collection(ACCOUNTS).where('uid', '==', uid))
    const ts = new Date(now())
    for (const link of links.docs) tx.delete(link.ref)
    tx.update(ref, {
      emailVerified: true,
      passwordHash: null,
      legacyPassword: null,
      providers: [],
      passwordChangedAt: ts,
      updatedAt: ts,
    })
  })
}

export async function recordLogin(uid: string): Promise<void> {
  const ts = new Date(now())
  await adminDb().collection(USERS).doc(uid).update({ lastLoginAt: ts, updatedAt: ts })
}
