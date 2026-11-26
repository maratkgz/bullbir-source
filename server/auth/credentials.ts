// Credential version — makes "sign out everywhere" real for Firestore/Storage, too.
//   auth_state/{uid} → { cv: epoch ms, updatedAt }   (server-only; rules may read it via get())
// Every bridge token carries the claim `bb_cv` = the cv at minting time, and the rules require
// `bb_cv >= cv`. Bumping cv therefore instantly locks out every Firebase ID token and every
// not-yet-exchanged custom token issued before — Firebase's own revokeRefreshTokens alone leaves
// ID tokens valid for up to an hour and does not stop pre-minted custom tokens.
// Bumped on: password reset/change, email change, sign-out-everywhere, account claim/takeover.
// On deletion the doc stays as a tombstone with the largest cv, so no old token can write again.
import { adminDb } from '../firebaseAdmin.js'
import { now } from './time.js'

export const AUTH_STATE = 'auth_state'
const TOMBSTONE_CV = Number.MAX_SAFE_INTEGER

export async function credentialVersion(uid: string): Promise<number> {
  const snap = await adminDb().collection(AUTH_STATE).doc(uid).get()
  const cv = snap.get('cv')
  return typeof cv === 'number' ? cv : 0
}

export async function bumpCredentialVersion(uid: string): Promise<void> {
  const db = adminDb()
  const ref = db.collection(AUTH_STATE).doc(uid)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.get('cv')
    const t = now()
    // Strictly increasing, whatever the instance clock says; a tombstone stays a tombstone.
    const next = typeof current === 'number' ? Math.max(current + 1, t) : t
    if (typeof current === 'number' && current >= TOMBSTONE_CV) return
    tx.set(ref, { cv: Math.min(next, TOMBSTONE_CV - 1), updatedAt: new Date(t) })
  })
}

export async function tombstoneCredentials(uid: string): Promise<void> {
  await adminDb().collection(AUTH_STATE).doc(uid).set({ cv: TOMBSTONE_CV, updatedAt: new Date(now()) })
}
